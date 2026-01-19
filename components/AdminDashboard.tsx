
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { dbService } from '../services/dbService';
import { Teacher, Grade, Class, Subject, School } from '../types';

interface Props {
  adminId: string;
}

const AdminDashboard: React.FC<Props> = ({ adminId }) => {
  const [school, setSchool] = useState<School | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);

  useEffect(() => {
    const loadSchool = async () => {
      const data = await dbService.getSchool(adminId);
      setSchool(data);
    };
    loadSchool();
  }, [adminId]);

  useEffect(() => {
    if (school) {
      dbService.getTeachers(adminId).then(setTeachers);
      dbService.getGrades(adminId).then(setGrades);
    }
  }, [school, adminId]);

  if (!school) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{school.name}</h1>
        <p className="text-slate-500 dark:text-slate-300 font-medium">Administrator Dashboard</p>
      </header>

      <Routes>
        <Route path="/" element={
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatsCard label="Total Teachers" value={teachers.length.toString()} color="blue" />
            <StatsCard label="Total Grades" value={grades.length.toString()} color="purple" />
            <StatsCard label="School ID" value={adminId.slice(0, 6).toUpperCase()} color="indigo" />
          </div>
        } />
        <Route path="/teachers" element={<TeachersView schoolId={adminId} />} />
        <Route path="/structure" element={<StructureView schoolId={adminId} />} />
      </Routes>
    </div>
  );
};

const TeachersView: React.FC<{ schoolId: string }> = ({ schoolId }) => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [password, setPassword] = useState('');
  const [filterSubject, setFilterSubject] = useState('All');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    dbService.getTeachers(schoolId).then(setTeachers);
  }, [schoolId]);

  const handleAdd = async () => {
    if (!name || !email || !subject || !password || !schoolId) {
      alert("All fields including temporary password are required.");
      return;
    }

    setIsAdding(true);
    try {
      // 1. Create the Auth account without signing out the admin
      const uid = await dbService.createUserAccount(email, password);

      // 2. Create the Teacher Profile and nested data
      await dbService.createTeacherProfile(schoolId, uid, {
        name,
        email,
        schoolId,
        primarySubject: subject,
        isClassTeacher: false,
        assignedSubjects: []
      }, password);

      const newTeacher: Teacher = {
        id: uid,
        name, email, schoolId,
        primarySubject: subject,
        isClassTeacher: false,
        assignedSubjects: []
      };

      setTeachers(prev => [...prev, newTeacher]);
      setName(''); setEmail(''); setSubject(''); setPassword('');
      alert(`Teacher account created for ${email}! They can now login with the password you set.`);
    } catch (err: any) {
      console.error(err);
      alert("Failed to create teacher account: " + err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (teacher: Teacher) => {
    if (!confirm(`Are you sure you want to delete ${teacher.name}? This will remove them and unassign them from any class.`)) return;
    try {
      await dbService.deleteTeacher(schoolId, teacher);
      setTeachers(teachers.filter(t => t.id !== teacher.id));
    } catch (err: any) {
      alert("Failed to delete teacher: " + err.message);
    }
  };

  const filteredTeachers = teachers.filter(t =>
    filterSubject === 'All' || t.primarySubject === filterSubject
  );

  const subjectsList = Array.from(new Set(teachers.map(t => t.primarySubject)));

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 border border-slate-200 dark:border-slate-700 shadow-sm animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold">Manage Teachers</h3>
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="input-style-sm w-auto">
          <option value="All">All Subjects</option>
          {subjectsList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-8">
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="input-style" />
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="input-style" />
        <input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} className="input-style" />
        <input type="password" placeholder="Temp Password" value={password} onChange={e => setPassword(e.target.value)} className="input-style" />
        <button
          onClick={handleAdd}
          disabled={isAdding}
          className={`bg-indigo-600 text-white font-bold rounded-xl px-6 py-2 transition-all hover:bg-indigo-700 active:scale-95 ${isAdding ? 'opacity-50' : ''}`}
        >
          {isAdding ? 'Creating...' : 'Add'}
        </button>
      </div>
      <div className="space-y-4">
        {filteredTeachers.map(t => (
          <div key={t.id} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/60 hover:shadow-md transition-all">
            <div>
              <p className="font-bold">{t.name}</p>
              <p className="text-sm text-slate-500">{t.email} • {t.primarySubject}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right space-y-1">
                {t.isClassTeacher && <span className="block text-[10px] font-black uppercase text-indigo-600">Class Teacher</span>}
                {t.assignedSubjects.length > 0 && <span className="block text-[10px] font-black uppercase text-purple-600">Subject Teacher</span>}
              </div>
              <button
                onClick={() => handleDelete(t)}
                className="text-slate-300 hover:text-red-500 transition-colors p-2"
                title="Remove Teacher"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const StructureView: React.FC<{ schoolId: string }> = ({ schoolId }) => {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradeName, setGradeName] = useState('');

  useEffect(() => {
    dbService.getGrades(schoolId).then(setGrades);
  }, [schoolId]);

  const handleAddGrade = async () => {
    if (!gradeName) return;
    const id = await dbService.addGrade(schoolId, { name: gradeName, schoolId });
    setGrades([...grades, { id, name: gradeName, schoolId }]);
    setGradeName('');
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 border border-slate-200 dark:border-slate-700 shadow-sm animate-in slide-in-from-bottom-4 duration-300">
      <h3 className="text-xl font-bold mb-6">School Structure</h3>
      <div className="flex gap-4 mb-8">
        <input placeholder="Grade (e.g. Grade 6)" value={gradeName} onChange={e => setGradeName(e.target.value)} className="input-style flex-1" />
        <button onClick={handleAddGrade} className="bg-indigo-600 text-white font-bold rounded-xl px-6 py-2 transition-all hover:bg-indigo-700 active:scale-95">Add Grade</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {grades.map(g => <GradeCard key={g.id} grade={g} adminId={schoolId} />)}
      </div>
    </div>
  );
};

const GradeCard: React.FC<{ grade: Grade; adminId: string }> = ({ grade, adminId }) => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [className, setClassName] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    dbService.getClasses(adminId, grade.id).then(setClasses);
    dbService.getSubjects(adminId, grade.id).then(setSubjects);
    dbService.getTeachers(adminId).then(setTeachers);
  }, [grade.id, adminId]);

  const handleAddClass = async () => {
    if (!className) return;
    const id = await dbService.addClass(adminId, {
      name: className,
      gradeId: grade.id,
      classTeacherId: selectedTeacherId || undefined
    });

    if (selectedTeacherId) {
      await dbService.assignClassTeacher(adminId, selectedTeacherId, id);
    }

    setClasses([...classes, {
      id,
      name: className,
      gradeId: grade.id,
      classTeacherId: selectedTeacherId || undefined
    }]);
    setClassName('');
    setSelectedTeacherId('');
  };

  const handleAddSubject = async () => {
    if (!subjectName) return;
    const id = await dbService.addSubject(adminId, {
      name: subjectName,
      gradeId: grade.id
    });
    setSubjects([...subjects, { id, name: subjectName, gradeId: grade.id }]);
    setSubjectName('');
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 hover:border-indigo-500/30 transition-all">
      <h4 className="font-black text-lg mb-4 text-indigo-600">{grade.name}</h4>

      <div className="space-y-6">
        {/* Subjects Section */}
        <div>
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Subjects</p>
          <div className="flex gap-2 mb-3">
            <input placeholder="New Subject" value={subjectName} onChange={e => setSubjectName(e.target.value)} className="input-style-sm flex-1" />
            <button onClick={handleAddSubject} className="bg-purple-600 text-white px-3 rounded-lg font-bold hover:bg-purple-700 transition-colors">+</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {subjects.map(s => (
              <span key={s.id} className="px-3 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300">
                {s.name}
              </span>
            ))}
          </div>
        </div>

        {/* Classes Section */}
        <div>
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Classes</p>
          <div className="flex gap-2 mb-4">
            <input placeholder="New Class" value={className} onChange={e => setClassName(e.target.value)} className="input-style-sm flex-1" />
            <select
              value={selectedTeacherId}
              onChange={e => setSelectedTeacherId(e.target.value)}
              className="text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 font-bold focus:ring-0"
            >
              <option value="">No Class Teacher</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={handleAddClass} className="bg-indigo-600 text-white px-3 rounded-lg font-bold hover:bg-indigo-700 transition-colors">+</button>
          </div>
          <div className="space-y-2">
            {classes.map(c => (
              <ClassRow
                key={c.id}
                studentClass={c}
                adminId={adminId}
                teachers={teachers}
                subjects={subjects}
                onUpdate={() => dbService.getClasses(adminId, grade.id).then(setClasses)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ClassRow: React.FC<{
  studentClass: Class;
  adminId: string;
  teachers: Teacher[];
  subjects: Subject[];
  onUpdate: () => void;
}> = ({ studentClass, adminId, teachers, subjects, onUpdate }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-slate-700 rounded-xl shadow-sm border border-slate-100 dark:border-slate-600 overflow-hidden">
      <div className="p-3 flex items-center justify-between">
        <span className="font-bold">{studentClass.name}</span>
        <div className="flex items-center gap-2">
          <select
            className="text-xs bg-transparent border-none font-bold text-slate-500 focus:ring-0 cursor-pointer hover:text-indigo-600 transition-colors"
            value={studentClass.classTeacherId || ''}
            onChange={async (e) => {
              const tid = e.target.value;
              if (!tid) return;
              await dbService.assignClassTeacher(adminId, tid, studentClass.id);
              onUpdate();
            }}
          >
            <option value="">Assign Class Teacher</option>
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            onClick={() => setExpanded(!expanded)}
            className={`p-1 rounded-lg transition-colors ${expanded ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
            title="Manage Subject Teachers"
          >
            ⚙️
          </button>
        </div>
      </div>

      {expanded && (
        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 border-t border-slate-100 dark:border-slate-700 grid gap-2 animate-in slide-in-from-top-2 duration-200">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Subject Teachers</p>
          {subjects.map(sub => (
            <div key={sub.id} className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 dark:text-slate-300">{sub.name}</span>
              <select
                className="bg-white dark:bg-slate-700 border-none rounded-lg text-xs py-1 pl-2 pr-6 font-medium focus:ring-1 focus:ring-indigo-500"
                value={studentClass.subjectTeachers?.[sub.id] || ''}
                onChange={async (e) => {
                  const tid = e.target.value;
                  if (!tid) return;
                  await dbService.assignSubjectTeacher(adminId, tid, {
                    gradeId: studentClass.gradeId,
                    classId: studentClass.id,
                    subjectId: sub.id // Keeping ID for mapping
                  });
                  onUpdate();
                }}
              >
                <option value="">Select Teacher</option>
                {teachers.filter(t => t.primarySubject === sub.name || t.assignedSubjects.some(as => as.subjectId === sub.name)).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
                <optgroup label="Other Teachers">
                  {teachers.filter(t => t.primarySubject !== sub.name).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          ))}
          {subjects.length === 0 && <p className="text-xs text-slate-400 italic">No subjects added to this grade yet.</p>}
        </div>
      )}
    </div>
  );
};

const StatsCard = ({ label, value, color }: any) => (
  <div className="p-8 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
    <p className="text-slate-500 font-medium mb-1 text-sm">{label}</p>
    <p className={`text-3xl font-black text-${color}-600`}>{value}</p>
  </div>
);

export default AdminDashboard;
