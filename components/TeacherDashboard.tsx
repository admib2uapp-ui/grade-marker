
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Assignment, Submission, MarkingCriterion, Teacher, Student, Subject, Class } from '../types';
import { dbService } from '../services/dbService';
import { extractMarkingPoints, analyzeTeachingNote, NoteSectionDraft, NoteAnalysisResult } from '../services/geminiService';

const TeacherDashboard: React.FC<{ teacherId: string, adminId: string }> = ({ teacherId, adminId }) => {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]); // TODO: Fetch from DB
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [draftEdit, setDraftEdit] = useState<Assignment | null>(null);
  const [draftImageFiles, setDraftImageFiles] = useState<File[]>([]);
  const [draftImagePreviews, setDraftImagePreviews] = useState<string[]>([]);

  // Create Assignment State
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<MarkingCriterion[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');

  // Display Names Map
  const [classNames, setClassNames] = useState<{ [key: string]: string }>({});
  const [subjectNames, setSubjectNames] = useState<{ [key: string]: string }>({});
  const [classData, setClassData] = useState<{ [key: string]: Class }>({});

  // Load Teacher Profile & Names
  useEffect(() => {
    const fetchProfileAndNames = async () => {
      const allTeachers = await dbService.getTeachers(adminId);
      const profile = allTeachers.find(t => t.id === teacherId);
      if (profile) {
        setTeacher(profile);

        // Fetch Names
        const cNames: { [key: string]: string } = {};
        const sNames: { [key: string]: string } = {};
        const cData: { [key: string]: Class } = {};

        // 1. My Class Name
        if (profile.assignedClassId) {
          const c = await dbService.getClass(adminId, profile.assignedClassId);
          if (c) {
            cNames[profile.assignedClassId] = c.name;
            cData[profile.assignedClassId] = c;
          }
        }

        // 2. Assigned Subjects Classes & Subject Names
        for (const assign of profile.assignedSubjects) {
          if (!cNames[assign.classId]) {
            const c = await dbService.getClass(adminId, assign.classId);
            if (c) {
              cNames[assign.classId] = c.name;
              cData[assign.classId] = c;
            }
          }
          if (!sNames[assign.subjectId]) {
            const s = await dbService.getSubject(adminId, assign.subjectId);
            // If subject found, use name. Else assume legacy ID-as-name or just show ID
            if (s) sNames[assign.subjectId] = s.name;
            else sNames[assign.subjectId] = assign.subjectId;
          }
        }
        setClassNames(cNames);
        setSubjectNames(sNames);
        setClassData(cData);
      }

      // Fetch Assignments
      const myAssignments = await dbService.getTeacherAssignments(adminId, teacherId);
      setAssignments(myAssignments);

      // Fetch all submissions for teacher's assignments
      const allSubmissions: Submission[] = [];
      for (const assignment of myAssignments) {
        const assignmentSubs = await dbService.getSubmissionsByAssignment(adminId, assignment.id);
        allSubmissions.push(...assignmentSubs);
      }
      setSubmissions(allSubmissions);
    };
    fetchProfileAndNames();
  }, [teacherId, adminId]);

  useEffect(() => {
    if (selectedAssignment?.status === 'DRAFT') {
      setDraftEdit({
        ...selectedAssignment,
        markingPoints: [...selectedAssignment.markingPoints],
        teacherAnswerImages: [...(selectedAssignment.teacherAnswerImages || [])],
        teacherAnswerImagesBase64: [...(selectedAssignment.teacherAnswerImagesBase64 || [])]
      });
      setDraftImageFiles([]);
      setDraftImagePreviews([]);
    } else {
      setDraftEdit(null);
    }
  }, [selectedAssignment]);

  const handleDraftImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDraftImageFiles(prev => [...prev, file]);
      const reader = new FileReader();
      reader.onloadend = () => setDraftImagePreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    }
  };

  const persistDraft = async (nextStatus?: 'DRAFT' | 'PUBLISHED') => {
    if (!draftEdit) return null;
    const uploadedUrls: string[] = [];
    for (const file of draftImageFiles) {
      const path = `assignments/${teacherId}/${Date.now()}_${file.name}`;
      const url = await dbService.uploadImage(file, path);
      uploadedUrls.push(url);
    }

    const updatedImages = [...(draftEdit.teacherAnswerImages || []), ...uploadedUrls];
    const updatedBase64 = [...(draftEdit.teacherAnswerImagesBase64 || []), ...draftImagePreviews];

    const updatedAssignment: Assignment = {
      ...draftEdit,
      teacherAnswerImages: updatedImages,
      teacherAnswerImagesBase64: updatedBase64,
      status: nextStatus || draftEdit.status
    };

    await dbService.saveAssignment(adminId, updatedAssignment);
    setAssignments(prev => prev.map(a => a.id === updatedAssignment.id ? updatedAssignment : a));
    setSelectedAssignment(updatedAssignment);
    setDraftEdit(updatedAssignment);
    setDraftImageFiles([]);
    setDraftImagePreviews([]);
    return updatedAssignment;
  };

  const uniqueAssignedSubjects = Array.from(new Set(teacher?.assignedSubjects.map(s => s.subjectId)))
    .map(id => ({ id, name: subjectNames[id] || id }));

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReferenceImages(prev => [...prev, file]);
      const reader = new FileReader();
      reader.onloadend = () => setReferenceImageUrls(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    }
  };

  const handleExtractCriteria = async () => {
    if (referenceImageUrls.length === 0) return;
    setIsExtracting(true);
    try {
      const points = await extractMarkingPoints(referenceImageUrls);
      setCriteria(points.map(p => ({ point: p, weight: 1 })));
    } catch (err) {
      alert("Failed to extract criteria");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async (status: 'DRAFT' | 'PUBLISHED') => {
    if (!title || !selectedSubjectId || !selectedClassId) {
      alert("Please fill all details and select a class/subject");
      return;
    }
    setIsSaving(true);
    try {
      // Upload images and keep base64 data
      const imageUrls: string[] = [];
      for (const file of referenceImages) {
        if (file instanceof File) {
          const path = `assignments/${teacherId}/${Date.now()}_${file.name}`;
          const url = await dbService.uploadImage(file, path);
          imageUrls.push(url);
        }
      }

      const newA: Assignment = {
        id: Date.now().toString(),
        title, question,
        teacherAnswerImages: imageUrls, // Storage URLs
        teacherAnswerImagesBase64: referenceImageUrls, // Base64 for Gemini
        markingPoints: criteria,
        createdAt: Date.now(),
        gradeId: 'extracted-from-class',
        classId: selectedClassId,
        subjectId: selectedSubjectId,
        teacherId,
        status
      };

      await dbService.saveAssignment(adminId, newA);
      setAssignments(prev => [newA, ...prev]);
      setShowAdd(false);
      setTitle(''); setQuestion(''); setCriteria([]); setReferenceImages([]); setReferenceImageUrls([]);
      alert(status === 'DRAFT' ? 'Draft saved!' : 'Assignment published!');
    } catch (err: any) {
      console.error(err);
      alert("Failed to save: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const drafts = assignments.filter(a => a.status === 'DRAFT');
  const published = assignments.filter(a => a.status === 'PUBLISHED');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Routes>
        <Route path="/" element={<TeacherOverview teacher={teacher} assignments={assignments} submissions={submissions} />} />

        <Route path="/assignments" element={
          <div className="space-y-8">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Assignments</h2>
                <p className="text-slate-500 font-medium">Create and manage your grading assignments</p>
              </div>
              <button onClick={() => setShowAdd(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-2xl font-bold transition-all hover:-translate-y-1 active:scale-95 shadow-lg shadow-indigo-200 dark:shadow-none">
                + Create Assignment
              </button>
            </div>

            {/* PUBLISHED */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-slate-400 uppercase tracking-widest pl-2 border-l-4 border-indigo-500">Active Assignments</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {published.map(a => (
                  <AssignmentCard key={a.id} assignment={a} onClick={() => setSelectedAssignment(a)} />
                ))}
                {published.length === 0 && (
                  <div className="col-span-full py-10 text-center text-slate-400 italic">No active assignments. Create one or publish a draft.</div>
                )}
              </div>
            </div>

            {/* DRAFTS */}
            {drafts.length > 0 && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-slate-400 uppercase tracking-widest pl-2 border-l-4 border-slate-300 dark:border-slate-700">Drafts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {drafts.map(a => (
                    <AssignmentCard key={a.id} assignment={a} onClick={() => setSelectedAssignment(a)} isDraft />
                  ))}
                </div>
              </div>
            )}

          </div>
        } />

        <Route path="/grades" element={
          <TeacherGradebook
            assignments={assignments}
            submissions={submissions}
            classNames={classNames}
            subjectNames={subjectNames}
          />
        } />

        <Route path="/students" element={
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
            <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Student Management</h2>
            {teacher?.isClassTeacher && (
              <MyClassView teacher={teacher} adminId={adminId} />
            )}
            <SubjectStudentsView teacher={teacher} adminId={adminId} />
          </div>
        } />

        <Route path="/notes" element={
          <TeacherNotes
            teacher={teacher}
            teacherId={teacherId}
            adminId={adminId}
            classNames={classNames}
            subjectNames={subjectNames}
            classData={classData}
            onDraftsCreated={(drafts) => setAssignments(prev => [...drafts, ...prev])}
          />
        } />

        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Routes>

      {/* Modals */}
      {selectedAssignment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[200] p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] w-full max-w-2xl p-10 shadow-2xl animate-in zoom-in-95 duration-300">
            {selectedAssignment.status === 'DRAFT' && draftEdit ? (
              <div className="space-y-2 mb-3">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Assignment Title</label>
                <input
                  className="input-style"
                  value={draftEdit.title}
                  onChange={e => setDraftEdit({ ...draftEdit, title: e.target.value })}
                />
              </div>
            ) : (
              <h3 className="text-2xl font-black mb-1">{selectedAssignment.title}</h3>
            )}
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-6">assignment Created on {new Date(selectedAssignment.createdAt).toLocaleDateString()}</p>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
              <div className="bg-slate-50 dark:bg-slate-700/60 p-6 rounded-3xl border border-slate-100 dark:border-slate-700">
                <p className="text-[10px] font-black uppercase text-indigo-500 tracking-widest mb-2">Reference Question</p>
                {selectedAssignment.status === 'DRAFT' && draftEdit ? (
                  <textarea
                    className="input-style h-32"
                    value={draftEdit.question}
                    onChange={e => setDraftEdit({ ...draftEdit, question: e.target.value })}
                  />
                ) : (
                  <p className="text-slate-600 dark:text-slate-300 font-medium leading-relaxed">{selectedAssignment.question}</p>
                )}
              </div>

              {(selectedAssignment.status === 'DRAFT' || (selectedAssignment.teacherAnswerImages && selectedAssignment.teacherAnswerImages.length > 0) || (draftEdit && (draftEdit.teacherAnswerImages?.length || 0) > 0) || (draftImagePreviews.length > 0)) && (
                <div className="space-y-3">
                  <h4 className="text-xl font-black">Question Images</h4>
                  <div className="flex flex-wrap gap-3">
                    {(selectedAssignment.status === 'DRAFT' ? (draftEdit?.teacherAnswerImages || []) : (selectedAssignment.teacherAnswerImages || [])).map((img, idx) => (
                      <div
                        key={`existing-${idx}`}
                        className="relative w-24 h-24 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer"
                        onClick={() => window.open(img, '_blank')}
                        title="Open image"
                      >
                        <img src={img} className="w-full h-full object-cover" />
                        {selectedAssignment.status === 'DRAFT' && draftEdit && (
                          <button
                            onClick={() => {
                              const updatedImages = draftEdit.teacherAnswerImages?.filter((_, i) => i !== idx) || [];
                              const updatedBase64 = draftEdit.teacherAnswerImagesBase64?.filter((_, i) => i !== idx) || [];
                              setDraftEdit({
                                ...draftEdit,
                                teacherAnswerImages: updatedImages,
                                teacherAnswerImagesBase64: updatedBase64
                              });
                            }}
                            className="absolute top-1 right-1 bg-white/90 dark:bg-slate-700/90 rounded-full w-5 h-5 text-xs flex items-center justify-center shadow-sm"
                            title="Remove image"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}

                    {draftImagePreviews.map((img, idx) => (
                      <div
                        key={`new-${idx}`}
                        className="relative w-24 h-24 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer"
                        onClick={() => window.open(img, '_blank')}
                        title="Open image"
                      >
                        <img src={img} className="w-full h-full object-cover" />
                        <button
                          onClick={() => {
                            setDraftImageFiles(draftImageFiles.filter((_, i) => i !== idx));
                            setDraftImagePreviews(draftImagePreviews.filter((_, i) => i !== idx));
                          }}
                          className="absolute top-1 right-1 bg-white/90 dark:bg-slate-700/90 rounded-full w-5 h-5 text-xs flex items-center justify-center shadow-sm"
                          title="Remove image"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {selectedAssignment.status === 'DRAFT' && (
                      <label className="w-24 h-24 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:border-indigo-400 active:scale-95">
                        <input type="file" accept="image/*" onChange={handleDraftImageChange} className="hidden" />
                        <span className="text-3xl text-slate-300 font-light">+</span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {selectedAssignment.status === 'DRAFT' && draftEdit && (
                <div className="space-y-3">
                  <h4 className="text-xl font-black">Marking Criteria</h4>
                  <div className="space-y-2">
                    {draftEdit.markingPoints.map((c, i) => (
                      <div key={i} className="flex gap-2 items-center bg-slate-50 dark:bg-slate-700/60 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                        <span className="text-xs font-black text-indigo-600 bg-white dark:bg-slate-800 w-6 h-6 rounded-lg flex items-center justify-center shadow-sm">{i + 1}</span>
                        <input
                          className="bg-transparent border-none text-sm font-bold flex-1 focus:ring-0"
                          value={c.point}
                          onChange={e => {
                            const updated = [...draftEdit.markingPoints];
                            updated[i] = { ...updated[i], point: e.target.value };
                            setDraftEdit({ ...draftEdit, markingPoints: updated });
                          }}
                        />
                        <input
                          type="number"
                          className="w-16 bg-white dark:bg-slate-800 border-none rounded-lg text-sm font-black text-center focus:ring-1 focus:ring-indigo-500"
                          value={c.weight}
                          onChange={e => {
                            const updated = [...draftEdit.markingPoints];
                            updated[i] = { ...updated[i], weight: parseInt(e.target.value) || 0 };
                            setDraftEdit({ ...draftEdit, markingPoints: updated });
                          }}
                        />
                        <button
                          onClick={() => {
                            const updated = draftEdit.markingPoints.filter((_, idx) => idx !== i);
                            setDraftEdit({ ...draftEdit, markingPoints: updated });
                          }}
                          className="w-6 h-6 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center justify-center transition-colors"
                          title="Delete criterion"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setDraftEdit({ ...draftEdit, markingPoints: [...draftEdit.markingPoints, { point: '', weight: 1 }] })}
                      className="w-full py-2 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-400 hover:border-indigo-400 hover:text-indigo-400 transition-all"
                    >
                      + Add Rule
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h4 className="text-xl font-black">Student Submissions</h4>

                {(() => {
                  const assignmentSubmissions = submissions.filter(s => s.assignmentId === selectedAssignment.id);
                  const submittedCount = assignmentSubmissions.length;
                  const uniqueStudentIds = new Set(assignmentSubmissions.map(s => s.studentId));
                  const uniqueSubmittedCount = uniqueStudentIds.size;

                  // Get total students in the class
                  const assignmentClass = classData[selectedAssignment.classId];
                  const totalStudents = assignmentClass?.studentIds?.length || 0;
                  const pendingCount = totalStudents - uniqueSubmittedCount;

                  return (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-900 rounded-2xl p-6 text-center">
                        <div className="text-4xl font-black text-emerald-600 dark:text-emerald-400 mb-2">{submittedCount}</div>
                        <p className="text-xs font-bold text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-widest">Submitted</p>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-200 dark:border-amber-900 rounded-2xl p-6 text-center">
                        <div className="text-4xl font-black text-amber-600 dark:text-amber-400 mb-2">
                          {pendingCount >= 0 ? pendingCount : '—'}
                        </div>
                        <p className="text-xs font-bold text-amber-600/70 dark:text-amber-400/70 uppercase tracking-widest">Pending</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="pt-8 mt-4 border-t border-slate-100 dark:border-slate-700">
              {selectedAssignment.status === 'DRAFT' ? (
                <div className="flex gap-4">
                  <button
                    onClick={() => setSelectedAssignment(null)}
                    className="flex-1 py-4 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-all active:scale-95"
                  >
                    Close
                  </button>
                  <button
                    disabled={isSaving || !draftEdit}
                    onClick={async () => {
                      if (!draftEdit) return;
                      setIsSaving(true);
                      try {
                        await persistDraft('DRAFT');
                        alert('Draft updated!');
                      } catch (err: any) {
                        alert('Failed to update draft: ' + err.message);
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    className="flex-1 py-4 bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-900 rounded-2xl font-black shadow-xl transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    disabled={isSaving}
                    onClick={async () => {
                      setIsSaving(true);
                      try {
                        const updatedAssignment = await persistDraft('PUBLISHED');
                        setSelectedAssignment(null);
                        alert('Assignment published successfully!');
                      } catch (err: any) {
                        alert('Failed to publish: ' + err.message);
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    className="flex-[2] py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Publishing...' : '📢 Publish Now'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSelectedAssignment(null)}
                  className="w-full py-4 bg-slate-900 dark:bg-indigo-600 text-white rounded-2xl font-black shadow-xl transition-all active:scale-95"
                >
                  Return to Dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[200] p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] w-full max-w-2xl p-10 shadow-2xl overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-300">
            <h3 className="text-3xl font-black mb-8">Create Assignment assignment</h3>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Class</label>
                  <select className="input-style" value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}>
                    <option value="">Select Class</option>
                    {teacher?.assignedClassId && <option value={teacher.assignedClassId}>{classNames[teacher.assignedClassId] || teacher.assignedClassId} (Class Teacher)</option>}
                    {teacher?.assignedSubjects.map((s, i) => (
                      <option key={i} value={s.classId}>{classNames[s.classId] || s.classId} ({subjectNames[s.subjectId] || s.subjectId})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Subject</label>
                  <select className="input-style" value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
                    <option value="">Select Subject</option>
                    {teacher?.primarySubject && !uniqueAssignedSubjects.some(s => s.name === teacher.primarySubject) && (
                      <option value={teacher.primarySubject}>{teacher.primarySubject}</option>
                    )}
                    {uniqueAssignedSubjects.map((s, i) => (
                      <option key={i} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Assignment Title</label>
                <input className="input-style" placeholder="Ex: Physics Mid-term" value={title} onChange={e => setTitle(e.target.value)} />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Question / Instructions</label>
                <textarea className="input-style h-40" placeholder="Enter the full question text here..." value={question} onChange={e => setQuestion(e.target.value)} />
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Correct Solution (Reference Images)</label>
                <div className="flex flex-wrap gap-3">
                  {referenceImageUrls.map((img, idx) => (
                    <div key={idx} className="relative w-24 h-24 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm animate-in zoom-in duration-200">
                      <img src={img} className="w-full h-full object-cover" />
                      <button onClick={() => {
                        setReferenceImages(referenceImages.filter((_, i) => i !== idx));
                        setReferenceImageUrls(referenceImageUrls.filter((_, i) => i !== idx));
                      }} className="absolute top-1 right-1 bg-white/90 dark:bg-slate-700/90 rounded-full w-5 h-5 text-xs flex items-center justify-center shadow-sm">✕</button>
                    </div>
                  ))}
                  <label className="w-24 h-24 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:border-indigo-400 active:scale-95">
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    <span className="text-3xl text-slate-300 font-light">+</span>
                  </label>
                </div>
                {referenceImageUrls.length > 0 && criteria.length === 0 && (
                  <button onClick={handleExtractCriteria} disabled={isExtracting} className={`w-full py-3 ${isExtracting ? 'bg-slate-100 dark:bg-slate-700 animate-pulse text-slate-400' : 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'} rounded-2xl text-sm font-black uppercase tracking-widest transition-all`}>
                    {isExtracting ? 'AI Analyzing Reference...' : '✨ Auto-Extract Marking Points'}
                  </button>
                )}
              </div>

              {criteria.length > 0 && (
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Marking Criteria & Weights</label>
                  <div className="space-y-2">
                    {criteria.map((c, i) => (
                      <div key={i} className="flex gap-2 items-center bg-slate-50 dark:bg-slate-700/60 p-3 rounded-xl border border-slate-100 dark:border-slate-700 animate-in slide-in-from-left duration-200" style={{ animationDelay: `${i * 50}ms` }}>
                        <span className="text-xs font-black text-indigo-600 bg-white dark:bg-slate-800 w-6 h-6 rounded-lg flex items-center justify-center shadow-sm">{i + 1}</span>
                        <input className="bg-transparent border-none text-sm font-bold flex-1 focus:ring-0" value={c.point} onChange={e => {
                          const newC = [...criteria];
                          newC[i].point = e.target.value;
                          setCriteria(newC);
                        }} />
                        <input type="number" className="w-16 bg-white dark:bg-slate-800 border-none rounded-lg text-sm font-black text-center focus:ring-1 focus:ring-indigo-500" value={c.weight} onChange={e => {
                          const newC = [...criteria];
                          newC[i].weight = parseInt(e.target.value) || 0;
                          setCriteria(newC);
                        }} />
                        <button
                          onClick={() => setCriteria(criteria.filter((_, idx) => idx !== i))}
                          className="w-6 h-6 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center justify-center transition-colors"
                          title="Delete criterion"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setCriteria([...criteria, { point: '', weight: 1 }])} className="w-full py-2 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-400 hover:border-indigo-400 hover:text-indigo-400 transition-all">+ Add Rule</button>
                  </div>
                </div>
              )}

              <div className="flex gap-4 pt-8">
                <button
                  onClick={() => setShowAdd(false)}
                  className="flex-1 py-4 text-slate-500 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={isSaving}
                  onClick={() => handleSave('DRAFT')}
                  className="flex-1 py-4 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-2xl font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  disabled={isSaving}
                  onClick={() => handleSave('PUBLISHED')}
                  className="flex-[2] py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? 'Publishing...' : 'Publish assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TeacherOverview: React.FC<{ teacher: Teacher | null, assignments: Assignment[], submissions: Submission[] }> = ({ teacher, assignments, submissions }) => {
  const [className, setClassName] = useState<string>('');
  const activeCount = assignments.filter(a => a.status === 'PUBLISHED').length;
  const draftCount = assignments.filter(a => a.status === 'DRAFT').length;

  useEffect(() => {
    const fetchClassName = async () => {
      if (teacher?.assignedClassId && teacher.schoolId) {
        const cls = await dbService.getClass(teacher.schoolId, teacher.assignedClassId);
        if (cls) setClassName(cls.name);
      }
    };
    fetchClassName();
  }, [teacher]);

  if (!teacher) return null;

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <header>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Welcome back, {teacher.name.split(' ')[0]}!</h1>
        <p className="text-slate-500 dark:text-slate-300 font-medium">Here's what's happening in your classes today.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-8 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-2xl">🏫</div>
            <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-black uppercase text-slate-500 tracking-wider">My Class</span>
          </div>
          {teacher.isClassTeacher && teacher.assignedClassId ? (
            <>
              <p className="text-3xl font-black text-slate-900 dark:text-white mb-1">Class {className || 'Loading...'}</p>
              <p className="text-slate-500 font-medium text-sm">You are the class teacher</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-slate-400 mb-1">No Class Assigned</p>
              <p className="text-slate-500 font-medium text-sm">Ask admin to assign one</p>
            </>
          )}
        </div>

        <div className="p-8 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 bg-purple-50 dark:bg-purple-950/40 rounded-2xl flex items-center justify-center text-purple-600 dark:text-purple-400 text-2xl">📚</div>
            <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-black uppercase text-slate-500 tracking-wider">Subjects</span>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mb-1">{teacher.primarySubject}</p>
          <p className="text-slate-500 font-medium text-sm">{teacher.assignedSubjects.length} Classes Assigned</p>
        </div>

        <div className="p-8 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-2xl">📝</div>
            <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-black uppercase text-slate-500 tracking-wider">Activity</span>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <p className="text-3xl font-black text-slate-900 dark:text-white">{activeCount}</p>
            <p className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Active</p>
          </div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-500">Drafts</span>
            <span className="text-slate-700 dark:text-slate-200">{draftCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const MyClassView: React.FC<{ teacher: Teacher, adminId: string }> = ({ teacher, adminId }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (teacher.assignedClassId) {
      dbService.getStudentsByClass(adminId, teacher.assignedClassId).then(setStudents);
    }
  }, [teacher.assignedClassId, adminId]);

  const handleAdd = async () => {
    if (!name || !email || !password || !teacher.assignedClassId) {
      alert("All fields including temporary password are required.");
      return;
    }

    setIsAdding(true);
    try {
      // Fetch class details to get the correct gradeId
      const cls = await dbService.getClass(teacher.schoolId, teacher.assignedClassId);
      const correctGradeId = cls ? cls.gradeId : 'unknown';

      // 1. Create the Auth account
      const uid = await dbService.createUserAccount(email, password);

      // 2. Create the Student Profile
      const studentProfile: Omit<Student, 'id'> = {
        name, email,
        schoolId: teacher.schoolId,
        classId: teacher.assignedClassId,
        gradeId: correctGradeId
      };

      await dbService.createStudentProfile(adminId, uid, studentProfile, password);

      setStudents([...students, { id: uid, ...studentProfile }]);
      setName(''); setEmail(''); setPassword('');
      alert(`Student account created for ${email}! They can now login with the password you set.`);
    } catch (err: any) {
      console.error(err);
      alert("Failed to create student account: " + err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (student: Student) => {
    if (!confirm(`Are you sure you want to remove ${student.name}? This cannot be undone.`)) return;

    try {
      await dbService.deleteStudent(adminId, student);
      setStudents(students.filter(s => s.id !== student.id));
    } catch (err: any) {
      alert("Failed to delete student: " + err.message);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-700 shadow-sm">
      <h3 className="text-xl font-bold mb-6">My Class Students</h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <input placeholder="Student Name" value={name} onChange={e => setName(e.target.value)} className="input-style" />
        <input placeholder="Student Email" value={email} onChange={e => setEmail(e.target.value)} className="input-style" />
        <input type="password" placeholder="Temp Password" value={password} onChange={e => setPassword(e.target.value)} className="input-style" />
        <button
          onClick={handleAdd}
          disabled={isAdding}
          className={`bg-indigo-600 hover:bg-indigo-700 text-white px-8 rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-indigo-100 dark:shadow-none ${isAdding ? 'opacity-50' : ''}`}
        >
          {isAdding ? 'Creating...' : 'Add Student'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {students.map(s => (
          <div key={s.id} className="p-5 bg-slate-50 dark:bg-slate-700/60 rounded-2xl border border-transparent hover:border-indigo-500/30 transition-all group flex justify-between items-center">
            <div>
              <p className="font-bold group-hover:text-indigo-600 transition-colors">{s.name}</p>
              <p className="text-xs text-slate-500 font-medium">{s.email}</p>
            </div>
            <button
              onClick={() => handleDelete(s)}
              className="text-slate-300 hover:text-red-500 transition-colors p-2"
              title="Remove Student"
            >
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const SubjectStudentsView: React.FC<{ teacher: Teacher | null, adminId: string }> = ({ teacher, adminId }) => {
  if (!teacher) return null;
  return (
    <div className="space-y-6 mt-6">
      <h3 className="text-xl font-bold">Subject Classes</h3>
      {teacher.assignedSubjects.map((sub, i) => (
        <SubjectClassRow key={i} subject={sub} adminId={adminId} />
      ))}
    </div>
  );
};

const SubjectClassRow: React.FC<{ subject: any, adminId: string }> = ({ subject, adminId }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [className, setClassName] = useState(subject.classId);
  const [subjectName, setSubjectName] = useState(subject.subjectId);

  useEffect(() => {
    dbService.getStudentsByClass(adminId, subject.classId).then(setStudents);

    // Fetch names
    dbService.getClass(adminId, subject.classId).then(c => {
      if (c) setClassName(c.name);
    });

    // Check if subject.subjectId looks like an ID (alphanumeric) or name
    // If it's an ID, try to fetch it.
    if (subject.subjectId) {
      dbService.getSubject(adminId, subject.subjectId).then(s => {
        if (s) setSubjectName(s.name);
        else setSubjectName(subject.subjectId); // Fallback to ID if not found (or if it was a name)
      });
    }

  }, [subject.classId, subject.subjectId, adminId]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm hover:border-indigo-500/30 transition-all">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-black text-indigo-600">Class {className} - {subjectName}</h4>
        <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-black uppercase text-slate-500 tracking-wider">
          {students.length} Students
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {students.map(s => <span key={s.id} className="px-4 py-2 bg-slate-50 dark:bg-slate-700/60 rounded-xl text-xs font-bold border border-slate-100 dark:border-slate-600/60">{s.name}</span>)}
      </div>
    </div>
  );
};

const TeacherNotes: React.FC<{
  teacher: Teacher | null;
  teacherId: string;
  adminId: string;
  classNames: { [key: string]: string };
  subjectNames: { [key: string]: string };
  classData: { [key: string]: Class };
  onDraftsCreated: (drafts: Assignment[]) => void;
}> = ({ teacher, teacherId, adminId, classNames, subjectNames, classData, onDraftsCreated }) => {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [noteBase64s, setNoteBase64s] = useState<string[]>([]);
  const [notePreviews, setNotePreviews] = useState<string[]>([]);
  const [notePrompt, setNotePrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<NoteAnalysisResult | null>(null);
  const [sections, setSections] = useState<NoteSectionDraft[]>([]);
  const [summary, setSummary] = useState('');
  const [isSavingDrafts, setIsSavingDrafts] = useState(false);

  if (!teacher) return null;

  const classOptions = Array.from(new Set([
    teacher.assignedClassId,
    ...teacher.assignedSubjects.map(s => s.classId)
  ].filter(Boolean))) as string[];

  const subjectOptionItems = (() => {
    const items = teacher.assignedSubjects.map(s => ({
      id: s.subjectId,
      label: subjectNames[s.subjectId] || s.subjectId
    }));

    if (teacher.primarySubject) {
      const exists = items.some(i => i.label === teacher.primarySubject || i.id === teacher.primarySubject);
      if (!exists) items.unshift({ id: teacher.primarySubject, label: teacher.primarySubject });
    }

    const seen = new Set<string>();
    return items.filter(i => {
      if (seen.has(i.label)) return false;
      seen.add(i.label);
      return true;
    });
  })();

  const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNoteFiles(prev => [...prev, file]);
    setNotePreviews(prev => [...prev, URL.createObjectURL(file)]);
    const reader = new FileReader();
    reader.onloadend = () => setNoteBase64s(prev => [...prev, reader.result as string]);
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!selectedClassId || !selectedSubjectId || noteBase64s.length === 0) {
      alert('Please select class, subject, and upload a note.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const className = classNames[selectedClassId] || selectedClassId;
      const subjectName = subjectNames[selectedSubjectId] || selectedSubjectId;
      const result = await analyzeTeachingNote(noteBase64s, { subjectName, className }, notePrompt.trim() || undefined);
      setAnalysis(result);
      setSummary(result.noteSummary || '');
      setSections(result.sections || []);
    } catch (err: any) {
      alert('Failed to analyze note: ' + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCreateDrafts = async () => {
    if (!selectedClassId || !selectedSubjectId || sections.length === 0) return;
    setIsSavingDrafts(true);
    try {
      const gradeId = classData[selectedClassId]?.gradeId || 'unknown';
      const drafts: Assignment[] = sections.map((section, idx) => ({
        id: `${Date.now()}_${idx}`,
        title: section.title,
        question: section.question,
        markingPoints: section.markingPoints,
        createdAt: Date.now() + idx,
        gradeId,
        classId: selectedClassId,
        subjectId: selectedSubjectId,
        teacherId,
        status: 'DRAFT'
      }));

      await Promise.all(drafts.map(d => dbService.saveAssignment(adminId, d)));
      onDraftsCreated(drafts);
      alert('Draft assignments created!');
    } catch (err: any) {
      alert('Failed to create drafts: ' + err.message);
    } finally {
      setIsSavingDrafts(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
      <div>
        <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Notes</h2>
        <p className="text-slate-500 font-medium">Upload your teaching notes to generate draft assignments by section.</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Class</label>
            <select className="input-style" value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}>
              <option value="">Select Class</option>
              {classOptions.map(id => (
                <option key={id} value={id}>{classNames[id] || id}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Subject</label>
            <select className="input-style" value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
              <option value="">Select Subject</option>
              {subjectOptionItems.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Upload Note (PDF)</label>
          <div className="flex flex-wrap gap-3">
            {noteFiles.map((f, idx) => (
              <div key={idx} className="px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60 text-sm font-bold flex items-center gap-3">
                <button
                  className="text-indigo-600"
                  onClick={() => window.open(notePreviews[idx], '_blank')}
                  title="Preview"
                >
                  📄
                </button>
                <span className="max-w-[200px] truncate">{f.name}</span>
                <button
                  onClick={() => {
                    setNoteFiles(noteFiles.filter((_, i) => i !== idx));
                    setNoteBase64s(noteBase64s.filter((_, i) => i !== idx));
                    setNotePreviews(notePreviews.filter((_, i) => i !== idx));
                  }}
                  className="text-slate-400 hover:text-red-500"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            <label className="px-4 py-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/60">
              <input type="file" accept="application/pdf" onChange={handleNoteChange} className="hidden" />
              <span className="text-sm font-bold text-slate-500">+ Add PDF</span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">AI Prompt (Optional)</label>
          <textarea
            className="input-style h-24"
            placeholder="Add guidance for the AI, e.g. focus on problem-solving steps, include 5 criteria per section..."
            value={notePrompt}
            onChange={e => setNotePrompt(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black shadow-lg shadow-indigo-100 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
          </button>
          <button
            onClick={() => {
              setAnalysis(null);
              setSections([]);
              setSummary('');
              setNotePrompt('');
            }}
            className="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold transition-all"
          >
            Clear Review
          </button>
        </div>
      </div>

      {analysis && (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
          <div className="space-y-2">
            <h3 className="text-xl font-black">Teacher Review Notes</h3>
            <textarea
              className="input-style h-32"
              value={summary}
              onChange={e => setSummary(e.target.value)}
            />
          </div>

          <div className="space-y-4">
            <h4 className="text-lg font-black">Draft Assignments by Section</h4>
            {sections.map((section, idx) => (
              <div key={idx} className="p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Title</label>
                    <input
                      className="input-style"
                      value={section.title}
                      onChange={e => {
                        const updated = [...sections];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setSections(updated);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Marking Points</label>
                    <div className="text-xs text-slate-500">{section.markingPoints.length} criteria</div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question</label>
                  <textarea
                    className="input-style h-28"
                    value={section.question}
                    onChange={e => {
                      const updated = [...sections];
                      updated[idx] = { ...updated[idx], question: e.target.value };
                      setSections(updated);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  {section.markingPoints.map((mp, mpIdx) => (
                    <div key={mpIdx} className="flex gap-2 items-center">
                      <input
                        className="input-style"
                        value={mp.point}
                        onChange={e => {
                          const updated = [...sections];
                          const updatedPoints = [...updated[idx].markingPoints];
                          updatedPoints[mpIdx] = { ...updatedPoints[mpIdx], point: e.target.value };
                          updated[idx] = { ...updated[idx], markingPoints: updatedPoints };
                          setSections(updated);
                        }}
                      />
                      <input
                        type="number"
                        className="w-20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-200 font-black text-center focus:ring-1 focus:ring-indigo-500"
                        value={mp.weight}
                        onChange={e => {
                          const updated = [...sections];
                          const updatedPoints = [...updated[idx].markingPoints];
                          updatedPoints[mpIdx] = { ...updatedPoints[mpIdx], weight: parseInt(e.target.value) || 0 };
                          updated[idx] = { ...updated[idx], markingPoints: updatedPoints };
                          setSections(updated);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleCreateDrafts}
              disabled={isSavingDrafts}
              className="px-6 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black shadow-xl shadow-indigo-100 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
            >
              {isSavingDrafts ? 'Creating Drafts...' : 'Create Draft Assignments'}
            </button>
            <button
              onClick={() => {
                setAnalysis(null);
                setSections([]);
                setSummary('');
                setNotePrompt('');
              }}
              className="px-6 py-4 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold transition-all"
            >
              Reset Review
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const TeacherGradebook: React.FC<{
  assignments: Assignment[];
  submissions: Submission[];
  classNames: { [key: string]: string };
  subjectNames: { [key: string]: string };
}> = ({ assignments, submissions, classNames, subjectNames }) => {
  const [expandedAssignments, setExpandedAssignments] = useState<{ [id: string]: boolean }>({});
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  const toggleAssignment = (assignmentId: string) => {
    setExpandedAssignments(prev => ({ ...prev, [assignmentId]: !prev[assignmentId] }));
    const selected = submissions.find(s => s.id === selectedSubmissionId);
    if (selected?.assignmentId === assignmentId && expandedAssignments[assignmentId]) {
      setSelectedSubmissionId(null);
    }
  };

  const sortedAssignments = assignments
    .filter(a => a.status === 'PUBLISHED')
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
      <div>
        <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Gradebook</h2>
        <p className="text-slate-500 font-medium">View submissions assignment-wise and review individual student results.</p>
      </div>

      {sortedAssignments.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-12 text-center border border-slate-200 dark:border-slate-700">
          <div className="text-5xl mb-4">📘</div>
          <p className="text-slate-500">No assignments found yet.</p>
        </div>
      )}

      <div className="space-y-4">
        {sortedAssignments.map(assignment => {
          const assignmentSubmissions = submissions.filter(s => s.assignmentId === assignment.id);
          const isExpanded = !!expandedAssignments[assignment.id];
          const selectedSubmission = assignmentSubmissions.find(s => s.id === selectedSubmissionId) || null;

          return (
            <div key={assignment.id} className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-sm">
              <button
                onClick={() => toggleAssignment(assignment.id)}
                className="w-full text-left p-6 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-[2rem] transition-colors"
              >
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-800 dark:text-white">{assignment.title}</h3>
                  <div className="text-xs font-bold text-slate-500 flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
                      Class {classNames[assignment.classId] || assignment.classId}
                    </span>
                    <span className="px-2 py-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
                      {subjectNames[assignment.subjectId] || assignment.subjectId}
                    </span>
                    <span className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
                      {assignmentSubmissions.length} Submissions
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-slate-400">
                  <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                  <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>⌄</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 dark:border-slate-700 p-6 space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 space-y-3">
                      <h4 className="text-sm font-black uppercase tracking-widest text-slate-400">Submitted Students</h4>
                      {assignmentSubmissions.length === 0 && (
                        <div className="text-sm text-slate-400 italic">No submissions yet.</div>
                      )}
                      <div className="space-y-2">
                        {assignmentSubmissions.map(sub => (
                          <button
                            key={sub.id}
                            onClick={() => setSelectedSubmissionId(sub.id)}
                            className={`w-full text-left px-4 py-3 rounded-2xl border transition-all ${selectedSubmissionId === sub.id
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                              : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 bg-white/50 dark:bg-slate-800'
                              }`}
                          >
                            <div className="font-bold">{sub.studentName || sub.studentId}</div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-400">
                              {sub.score ?? 0}/{sub.maxScore ?? 0}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-2">
                      {!selectedSubmission && (
                        <div className="h-full flex items-center justify-center text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-700 rounded-3xl p-10">
                          Select a student to view submission details.
                        </div>
                      )}

                      {selectedSubmission && (
                        <div className="space-y-6">
                          <div className="bg-slate-50 dark:bg-slate-700/60 rounded-3xl p-6 border border-slate-100 dark:border-slate-700">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                              <div>
                                <h4 className="text-2xl font-black text-slate-800 dark:text-white">{selectedSubmission.studentName || selectedSubmission.studentId}</h4>
                                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                                  {selectedSubmission.gradedAt ? `Graded ${new Date(selectedSubmission.gradedAt).toLocaleDateString()}` : 'Not graded yet'}
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400">
                                  {selectedSubmission.score ?? 0}/{selectedSubmission.maxScore ?? 0}
                                </div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Score</p>
                              </div>
                            </div>
                            {selectedSubmission.feedback && (
                              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{selectedSubmission.feedback}</p>
                            )}
                          </div>

                          <div className="space-y-3">
                            <h5 className="text-sm font-black uppercase tracking-widest text-slate-400">Criteria Breakdown</h5>
                            <div className="space-y-2">
                              {assignment.markingPoints.map((criterion, idx) => {
                                const met = selectedSubmission.criteriasMet?.[idx];
                                const score = selectedSubmission.criteriaScores?.[idx];
                                const color = met === true
                                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                                  : met === false
                                    ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                                    : 'border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300';

                                return (
                                  <div key={idx} className={`p-4 rounded-2xl border ${color} flex items-center justify-between gap-4`}>
                                    <div className="flex items-start gap-3">
                                      <div className="w-7 h-7 rounded-lg bg-white/70 dark:bg-slate-800/80 text-xs font-black flex items-center justify-center">{idx + 1}</div>
                                      <div className="text-sm font-semibold leading-snug">{criterion.point}</div>
                                    </div>
                                    <div className="text-sm font-black">
                                      {score !== undefined ? score : '—'} / {criterion.weight}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TeacherDashboard;

const AssignmentCard: React.FC<{ assignment: Assignment, onClick: () => void, isDraft?: boolean }> = ({ assignment, onClick, isDraft }) => (
  <div
    onClick={onClick}
    className={`group cursor-pointer bg-white dark:bg-slate-800 border ${isDraft ? 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60' : 'border-slate-200 dark:border-slate-700'} rounded-3xl p-7 shadow-sm hover:shadow-xl hover:border-indigo-400 transition-all hover:-translate-y-1`}
  >
    <div className={`w-12 h-12 ${isDraft ? 'bg-slate-200 dark:bg-slate-700 text-slate-500' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'} rounded-2xl flex items-center justify-center text-xl mb-4 group-hover:scale-110 transition-transform`}>
      {isDraft ? '📝' : '📄'}
    </div>
    <h3 className="text-xl font-bold mb-2 group-hover:text-indigo-600 transition-colors line-clamp-1">{assignment.title}</h3>
    <p className="text-slate-500 text-sm line-clamp-3 mb-6 leading-relaxed">{assignment.question}</p>
    <div className="pt-6 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs font-bold text-slate-400">
      <span>{new Date(assignment.createdAt).toLocaleDateString()}</span>
      <span className={`px-3 py-1 rounded-full text-[10px] ${isDraft ? 'bg-slate-200 text-slate-600' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600'}`}>
        {isDraft ? 'DRAFT' : 'View Details'}
      </span>
    </div>
  </div>
);
