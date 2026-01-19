
import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Assignment, Submission } from '../types';
import { analyzeAnswer } from '../services/geminiService';
import { dbService } from '../services/dbService';

interface Props {
  studentId: string;
  adminId: string;
  classId: string;
}

const StudentDashboard: React.FC<Props> = ({ studentId, adminId, classId }) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [studentName, setStudentName] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmissionResult, setLastSubmissionResult] = useState<Submission | null>(null);

  // Fetch published assignments for this class
  useEffect(() => {
    const fetchData = async () => {
      if (classId && adminId) {
        const classAssignments = await dbService.getStudentAssignments(adminId, classId);
        setAssignments(classAssignments);

        // Fetch student's submissions
        const studentSubmissions = await dbService.getSubmissionsByStudent(adminId, studentId);
        setSubmissions(studentSubmissions);
      }
    };
    fetchData();
  }, [adminId, classId, studentId]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFiles(prev => [...prev, file]);
      const reader = new FileReader();
      reader.onloadend = () => setImageUrls(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmission = async () => {
    if (!selectedAssignment || imageFiles.length === 0 || !studentName) {
      alert("Missing name or files");
      return;
    }
    setIsSubmitting(true);
    try {
      // Upload images to Storage
      const uploadedImageUrls: string[] = [];
      for (const file of imageFiles) {
        const path = `submissions/${studentId}/${Date.now()}_${file.name}`;
        const url = await dbService.uploadImage(file, path);
        uploadedImageUrls.push(url);
      }

      // Grade using AI with base64 preview URLs
      const grading = await analyzeAnswer(selectedAssignment, imageUrls);
      const scores = grading.criteriasMet.map((met, idx) => met ? (selectedAssignment.markingPoints[idx]?.weight || 0) : 0);

      const newSub: Submission = {
        id: Date.now().toString(),
        assignmentId: selectedAssignment.id,
        studentId: studentId,
        studentName,
        studentAnswerImages: uploadedImageUrls, // Storage URLs
        studentAnswerImagesBase64: imageUrls, // Base64 for Gemini
        score: scores.reduce((a, b) => a + b, 0),
        maxScore: grading.totalPossible,
        feedback: grading.feedback,
        criteriaScores: scores,
        criteriasMet: grading.criteriasMet,
        gradedAt: Date.now()
      };

      // Save to Firestore
      await dbService.saveSubmission(adminId, newSub);

      setSubmissions(prev => [newSub, ...prev]);
      setLastSubmissionResult(newSub);
      setSelectedAssignment(null);
      setImageFiles([]);
      setImageUrls([]);
      setStudentName('');
    } catch (err) {
      console.error(err);
      alert("Error during grading");
    } finally {
      setIsSubmitting(false);
    }
  };

  const { pending, completed } = useMemo(() => {
    const p: Assignment[] = [];
    const c: Assignment[] = [];
    assignments.forEach(a => {
      if (submissions.some(s => s.assignmentId === a.id)) c.push(a);
      else p.push(a);
    });
    return { pending: p, completed: c };
  }, [assignments, submissions]);

  return (
    <div className="space-y-12 animate-in fade-in duration-500">
      <Routes>
        <Route path="/" element={
          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-black tracking-tight mb-2">My Current Tasks</h2>
              <p className="text-slate-500 font-medium">Finish your assignments to see AI feedback</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {pending.map(a => (
                <div key={a.id} className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-700 p-8 shadow-sm flex flex-col transition-all hover:shadow-xl hover:border-indigo-400 group hover:-translate-y-1">
                  <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-2xl mb-6 group-hover:scale-110 transition-transform">📝</div>
                  <h3 className="text-xl font-bold mb-3 group-hover:text-indigo-600 transition-colors line-clamp-1">{a.title}</h3>
                  <p className="text-slate-500 text-sm mb-8 flex-1 leading-relaxed line-clamp-4">{a.question}</p>
                  <button onClick={() => setSelectedAssignment(a)} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-100 dark:shadow-none active:scale-95">
                    Start Submission
                  </button>
                </div>
              ))}
              {pending.length === 0 && (
                <div className="col-span-full py-20 bg-emerald-50/50 dark:bg-emerald-950/20 border-2 border-dashed border-emerald-100 dark:border-emerald-900 rounded-[2rem] text-center animate-in zoom-in-95 duration-500">
                  <div className="text-5xl mb-4">🎉</div>
                  <p className="text-emerald-600 dark:text-emerald-400 font-black text-xl">All caught up!</p>
                  <p className="text-emerald-600/60 dark:text-emerald-400/60 font-bold">No pending assignments for now.</p>
                </div>
              )}
            </div>
          </div>
        } />

        <Route path="/grades" element={
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
            <h2 className="text-3xl font-black tracking-tight">Grading History</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {completed.map(a => {
                const sub = submissions.find(s => s.assignmentId === a.id);
                if (!sub) return null;
                return (
                  <div key={a.id} className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 p-8 shadow-sm hover:border-indigo-500/30 transition-all">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="text-2xl font-black mb-1 line-clamp-1">{a.title}</h3>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Submitted {new Date(sub.gradedAt || 0).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-4xl font-black text-indigo-600">{sub.score} <span className="text-sm opacity-40">/ {sub.maxScore}</span></p>
                      </div>
                    </div>
                    <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-6 rounded-3xl border border-indigo-100 dark:border-indigo-900/40 italic text-indigo-800 dark:text-indigo-300 font-medium mb-6 relative">
                      <div className="absolute -top-3 left-6 px-2 bg-white dark:bg-slate-800 text-[10px] font-black text-indigo-400 uppercase tracking-tighter">AI Feedback</div>
                      "{sub.feedback}"
                    </div>
                    <div className="space-y-3 px-2">
                      {a.markingPoints.map((mp, i) => {
                        const met = sub.criteriaScores?.[i] === mp.weight;
                        return (
                          <div key={i} className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${met ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className="text-slate-500 font-bold">{mp.point}</span>
                            </div>
                            <span className={`font-black whitespace-nowrap ${met ? 'text-emerald-500' : 'text-red-500'}`}>
                              {sub.criteriaScores?.[i] || 0}/{mp.weight}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {completed.length === 0 && (
                <div className="col-span-full py-20 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-[2rem] text-center opacity-50">
                  <div className="text-4xl mb-4">📉</div>
                  <p className="text-slate-400 font-bold">No results to show yet.</p>
                </div>
              )}
            </div>
          </div>
        } />

        <Route path="*" element={<Navigate to="/student" replace />} />
      </Routes>

      {/* SUBMISSION MODAL */}
      {selectedAssignment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[200] p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl overflow-y-auto max-h-[90vh] border border-white/10 animate-in zoom-in-95 duration-300">
            <h3 className="text-3xl font-black mb-8">Ready to Submit?</h3>
            <div className="space-y-6">
              {/* Reference Images from Teacher */}
              {selectedAssignment.teacherAnswerImages && selectedAssignment.teacherAnswerImages.length > 0 && (
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Question Images</label>
                  <div className="flex flex-wrap gap-3">
                    {selectedAssignment.teacherAnswerImages.map((img, idx) => (
                      <div key={idx} className="relative w-24 h-24 rounded-2xl overflow-hidden border border-indigo-200 dark:border-indigo-800 shadow-sm cursor-pointer hover:scale-105 transition-transform" onClick={() => window.open(img, '_blank')}>
                        <img src={img} className="w-full h-full object-cover" alt={`Question ${idx + 1}`} />
                        <div className="absolute inset-0 bg-indigo-600/0 hover:bg-indigo-600/10 transition-colors flex items-center justify-center">
                          <span className="text-white opacity-0 hover:opacity-100 text-xs">🔍</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 italic">Click on images to view full size</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Your Full Name</label>
                <input className="input-style" value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="Ex: Alex Johnson" />
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Attach Your Solutions</label>
                <div className="flex flex-wrap gap-3">
                  {imageUrls.map((img, idx) => (
                    <div key={idx} className="relative w-24 h-24 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm animate-in zoom-in duration-200">
                      {img.startsWith('data:application/pdf') ? <div className="w-full h-full bg-red-50 dark:bg-red-950/20 flex items-center justify-center font-bold text-red-500 text-[10px]">PDF</div> : <img src={img} className="w-full h-full object-cover" />}
                      <button onClick={() => {
                        setImageFiles(imageFiles.filter((_, i) => i !== idx));
                        setImageUrls(imageUrls.filter((_, i) => i !== idx));
                      }} className="absolute top-1 right-1 bg-white/90 dark:bg-slate-700/90 rounded-full w-5 h-5 text-[10px] flex items-center justify-center shadow-sm">✕</button>
                    </div>
                  ))}
                  <label className="w-24 h-24 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-all hover:border-indigo-400 active:scale-95">
                    <input type="file" accept="image/*,application/pdf" onChange={handleImageChange} className="hidden" />
                    <span className="text-3xl text-slate-300 font-light">+</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-4 pt-8">
                <button onClick={() => { setSelectedAssignment(null); setImageFiles([]); setImageUrls([]); }} className="flex-1 py-4 font-bold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-colors">Cancel</button>
                <button disabled={isSubmitting || !studentName || imageFiles.length === 0} onClick={handleSubmission} className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 dark:shadow-none disabled:opacity-50 transition-all active:scale-95">
                  {isSubmitting ? 'AI Grading...' : 'Submit Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FINAL SCORE CELEBRATION MODAL */}
      {lastSubmissionResult && (
        <div className="fixed inset-0 bg-indigo-600/90 backdrop-blur-2xl flex items-center justify-center z-[250] p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-[3rem] w-full max-w-md p-12 shadow-2xl text-center animate-in zoom-in-95 duration-500">
            <div className="w-24 h-24 bg-indigo-50 dark:bg-indigo-950/40 rounded-full flex items-center justify-center text-5xl mx-auto mb-6">🎉</div>
            <h3 className="text-3xl font-black mb-2 dark:text-white">Well Done!</h3>
            <p className="text-slate-500 font-medium mb-8">Your work has been graded by SmartGrader AI.</p>
            <div className="p-8 bg-slate-50 dark:bg-slate-700 rounded-3xl border border-slate-200 dark:border-slate-700 mb-8">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Final Result</p>
              <p className="text-7xl font-black text-indigo-600">{lastSubmissionResult.score} <span className="text-2xl opacity-40">/ {lastSubmissionResult.maxScore}</span></p>
            </div>
            <button onClick={() => setLastSubmissionResult(null)} className="w-full py-5 bg-slate-900 dark:bg-indigo-600 text-white rounded-2xl font-black hover:scale-[1.02] shadow-xl transition-all active:scale-95">
              Back to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
