import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  collection, doc, setDoc, addDoc, getDocs, query, where, getDoc,
  updateDoc, arrayUnion, serverTimestamp, deleteDoc, arrayRemove, deleteField
} from 'firebase/firestore';
import { db, firebaseConfig } from './firebase';
import { School, Teacher, Grade, Class, Subject, Student, AssignedSubject, UserRole, Assignment, Submission } from '../types';

// Secondary app for creating users without signing out the current one
const secondaryApp = getApps().find(a => a.name === 'Secondary') || initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

// Helper to get nested collection reference
const getNestedColl = (adminId: string, collName: string) =>
  collection(db, 'users', adminId, collName);

export const dbService = {
  // --- Auth / User Account Creation ---
  async createUserAccount(email: string, password: string) {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    // After creation, sign out from the secondary auth immediately
    await secondaryAuth.signOut();
    return userCredential.user.uid;
  },

  // --- Admin/User Profile ---
  async createAdminProfile(adminId: string, email: string) {
    await setDoc(doc(db, 'users', adminId), {
      id: adminId,
      email: email.toLowerCase(),
      role: UserRole.ADMIN,
      createdAt: serverTimestamp()
    });
  },

  async createTeacherProfile(adminId: string, teacherId: string, profile: Omit<Teacher, 'id'>, password?: string) {
    // 1. Create top-level user doc for role management
    await setDoc(doc(db, 'users', teacherId), {
      id: teacherId,
      email: profile.email.toLowerCase(),
      role: UserRole.TEACHER,
      adminId, // link to school admin
      tempPassword: password, // Store for login reference
      createdAt: serverTimestamp()
    });

    // 2. Create nested teacher doc in school structure
    await setDoc(doc(db, 'users', adminId, 'teachers', teacherId), {
      id: teacherId,
      ...profile,
      email: profile.email.toLowerCase(),
      createdAt: serverTimestamp()
    });
  },

  async createStudentProfile(adminId: string, studentId: string, profile: Omit<Student, 'id'>, password?: string) {
    await setDoc(doc(db, 'users', studentId), {
      id: studentId,
      email: profile.email.toLowerCase(),
      role: UserRole.STUDENT,
      adminId,
      tempPassword: password,
      ...profile, // Sync classId, gradeId, etc. for easy access
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db, 'users', adminId, 'students', studentId), {
      id: studentId,
      ...profile,
      createdAt: serverTimestamp()
    });

    // 3. Update Class document with studentId
    if (profile.classId) {
      const classRef = doc(db, 'users', adminId, 'classes', profile.classId);
      await updateDoc(classRef, {
        studentIds: arrayUnion(studentId)
      });
    }
  },

  async getUserProfile(uid: string) {
    const d = await getDoc(doc(db, 'users', uid));
    return d.exists() ? d.data() : null;
  },

  async getAdminProfile(adminId: string) {
    // For backward compatibility or specific admin data
    const d = await getDoc(doc(db, 'users', adminId));
    const data = d.exists() ? d.data() : null;
    return data?.role === 'ADMIN' ? data : null;
  },

  // --- School ---
  async createSchool(adminId: string, school: Omit<School, 'id' | 'adminId'>) {
    const schoolData = { ...school, adminId, createdAt: serverTimestamp() };
    await setDoc(doc(db, 'users', adminId, 'school', 'info'), schoolData);
    return 'info';
  },

  async getSchool(adminId: string): Promise<School | null> {
    const d = await getDoc(doc(db, 'users', adminId, 'school', 'info'));
    return d.exists() ? { id: 'info', ...d.data() } as School : null;
  },

  // --- Teachers ---
  async addTeacher(adminId: string, teacher: Teacher) {
    await setDoc(doc(getNestedColl(adminId, 'teachers'), teacher.id), {
      ...teacher,
      createdAt: serverTimestamp()
    });
  },

  async getTeachers(adminId: string): Promise<Teacher[]> {
    const q = await getDocs(getNestedColl(adminId, 'teachers'));
    return q.docs.map(d => d.data() as Teacher);
  },

  // --- Grades & Structure ---
  async addGrade(adminId: string, grade: Omit<Grade, 'id'>) {
    const docRef = await addDoc(getNestedColl(adminId, 'grades'), grade);
    return docRef.id;
  },

  async getGrades(adminId: string): Promise<Grade[]> {
    const q = await getDocs(getNestedColl(adminId, 'grades'));
    return q.docs.map(d => ({ id: d.id, ...d.data() }) as Grade);
  },

  async addClass(adminId: string, classData: Omit<Class, 'id'>) {
    const docRef = await addDoc(getNestedColl(adminId, 'classes'), classData);
    return docRef.id;
  },

  async getClasses(adminId: string, gradeId: string): Promise<Class[]> {
    const q = query(getNestedColl(adminId, 'classes'), where('gradeId', '==', gradeId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Class);
  },

  async getClass(adminId: string, classId: string): Promise<Class | null> {
    const d = await getDoc(doc(getNestedColl(adminId, 'classes'), classId));
    return d.exists() ? { id: d.id, ...d.data() } as Class : null;
  },

  async addSubject(adminId: string, subject: Omit<Subject, 'id'>) {
    const docRef = await addDoc(getNestedColl(adminId, 'subjects'), subject);
    return docRef.id;
  },

  async getSubjects(adminId: string, gradeId: string): Promise<Subject[]> {
    const q = query(getNestedColl(adminId, 'subjects'), where('gradeId', '==', gradeId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Subject);
  },

  async getSubject(adminId: string, subjectId: string): Promise<Subject | null> {
    const d = await getDoc(doc(getNestedColl(adminId, 'subjects'), subjectId));
    return d.exists() ? { id: d.id, ...d.data() } as Subject : null;
  },

  // --- Assignments ---
  async assignClassTeacher(adminId: string, teacherId: string, classId: string) {
    const classRef = doc(getNestedColl(adminId, 'classes'), classId);
    await updateDoc(classRef, { classTeacherId: teacherId });

    // 1. Update teacher record in nested collection
    const teacherRef = doc(getNestedColl(adminId, 'teachers'), teacherId);
    await updateDoc(teacherRef, { isClassTeacher: true, assignedClassId: classId });

    // 2. Sync to top-level user doc
    const userRef = doc(db, 'users', teacherId);
    await updateDoc(userRef, { isClassTeacher: true, assignedClassId: classId });
  },

  async assignSubjectTeacher(adminId: string, teacherId: string, assignment: AssignedSubject) {
    // 1. Update nested teacher record
    const teacherRef = doc(getNestedColl(adminId, 'teachers'), teacherId);
    await updateDoc(teacherRef, {
      assignedSubjects: arrayUnion(assignment)
    });

    // 2. Sync to top-level user doc
    const userRef = doc(db, 'users', teacherId);
    await updateDoc(userRef, {
      assignedSubjects: arrayUnion(assignment)
    });

    // 3. Update Class document with subject -> teacher mapping
    const classRef = doc(getNestedColl(adminId, 'classes'), assignment.classId);
    await setDoc(classRef, {
      subjectTeachers: {
        [assignment.subjectId]: teacherId
      }
    }, { merge: true });
  },

  // --- Students ---
  async addStudent(adminId: string, student: Omit<Student, 'id'>) {
    const docRef = await addDoc(getNestedColl(adminId, 'students'), {
      ...student,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  },

  async getStudentsByClass(adminId: string, classId: string): Promise<Student[]> {
    const q = query(getNestedColl(adminId, 'students'), where('classId', '==', classId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Student);
  },

  async deleteStudent(adminId: string, student: Student) {
    // 1. Delete from nested collection
    await deleteDoc(doc(getNestedColl(adminId, 'students'), student.id));

    // 2. Delete from top-level user collection
    await deleteDoc(doc(db, 'users', student.id));

    // 3. Remove from Class document
    if (student.classId) {
      const classRef = doc(db, 'users', adminId, 'classes', student.classId);
      await updateDoc(classRef, {
        studentIds: arrayRemove(student.id)
      });
    }

    // Note: We cannot delete the Auth User from the client SDK (requires Admin SDK).
    // The account will remain but have no profile data, preventing login.
  },

  async deleteTeacher(adminId: string, teacher: Teacher) {
    // 1. Delete from nested collection
    await deleteDoc(doc(getNestedColl(adminId, 'teachers'), teacher.id));

    // 2. Delete from top-level user collection
    await deleteDoc(doc(db, 'users', teacher.id));

    // 3. Unassign from Class if applicable
    if (teacher.assignedClassId) {
      const classRef = doc(db, 'users', adminId, 'classes', teacher.assignedClassId);
      await updateDoc(classRef, {
        classTeacherId: deleteField()
      });
    }
  },

  // --- Invitations ---
  async inviteTeacher(email: string, adminId: string, schoolName: string) {
    await setDoc(doc(db, 'teacher_invites', email.toLowerCase()), {
      adminId,
      schoolName,
      invitedAt: serverTimestamp()
    });
  },

  async getTeacherInvite(email: string) {
    const d = await getDoc(doc(db, 'teacher_invites', email.toLowerCase()));
    return d.exists() ? d.data() : null;
  },

  async deleteTeacherInvite(email: string) {
    // Optional: cleanup after signup
  },

  async getTeacherProfileByEmail(email: string): Promise<any | null> {
    const q = query(collection(db, 'users'), where('email', '==', email.toLowerCase()), where('role', '==', 'TEACHER'));
    const snap = await getDocs(q);
    return !snap.empty ? snap.docs[0].data() : null;
  },

  // --- Image Upload ---
  async uploadImage(file: File, path: string): Promise<string> {
    // Dynamically import storage to avoid issues if not initialized strictly
    const { storage } = await import('./firebase');
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');

    // Create a reference
    const storageRef = ref(storage, path);

    // Upload
    await uploadBytes(storageRef, file);

    // Get URL
    return await getDownloadURL(storageRef);
  },

  // --- Assignments Persistence ---
  async saveAssignment(adminId: string, assignment: Assignment) {
    // Save to top-level assignments collection for easy querying, or nested? 
    // Requirement: "teacher needs to see all assignments".
    // Let's store in top-level 'assignments' coll but include adminId/schoolId metadata.
    // Actually, sticking to hierarchical: users/{adminId}/assignments/{assignmentId}
    const docRef = doc(getNestedColl(adminId, 'assignments'), assignment.id);
    await setDoc(docRef, assignment, { merge: true });
  },

  async getTeacherAssignments(adminId: string, teacherId: string): Promise<Assignment[]> {
    const q = query(getNestedColl(adminId, 'assignments'), where('teacherId', '==', teacherId));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Assignment).sort((a, b) => b.createdAt - a.createdAt);
  },

  async getStudentAssignments(adminId: string, classId: string): Promise<Assignment[]> {
    // Only published assignments for the student's class
    const q = query(
      getNestedColl(adminId, 'assignments'),
      where('classId', '==', classId),
      where('status', '==', 'PUBLISHED')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Assignment).sort((a, b) => b.createdAt - a.createdAt);
  },

  // --- Submissions Persistence ---
  async saveSubmission(adminId: string, submission: Submission) {
    // Store in hierarchical structure: users/{adminId}/submissions/{submissionId}
    const docRef = doc(getNestedColl(adminId, 'submissions'), submission.id);
    await setDoc(docRef, submission, { merge: true });
  },

  async getSubmissionsByAssignment(adminId: string, assignmentId: string): Promise<Submission[]> {
    const q = query(getNestedColl(adminId, 'submissions'), where('assignmentId', '==', assignmentId));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Submission).sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0));
  },

  async getSubmissionsByStudent(adminId: string, studentId: string): Promise<Submission[]> {
    const q = query(getNestedColl(adminId, 'submissions'), where('studentId', '==', studentId));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Submission).sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0));
  }
};
