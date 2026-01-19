
import React, { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { dbService } from '../services/dbService';

interface Props {
  onAuthSuccess: (uid: string) => void;
}

const Auth: React.FC<Props> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeRole, setActiveRole] = useState<string | null>(null);

  // Auto-fill from invite link and handle role from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const modeParam = params.get('mode');
    const roleParam = params.get('role');

    if (emailParam) setEmail(emailParam);
    if (modeParam === 'signup' && roleParam === 'ADMIN') setIsLogin(false);
    if (roleParam) setActiveRole(roleParam);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        onAuthSuccess(userCredential.user.uid);
      } else {
        // 1. Check if email has a Teacher Invitation
        const invite = await dbService.getTeacherInvite(email);

        if (invite) {
          // Note: The user now wants Admin to create accounts, 
          // but for client-side only, this "Invitation completion" 
          // is effectively the teacher setting their password.
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const uid = userCredential.user.uid;

          await dbService.createTeacherProfile(invite.adminId, uid, {
            name: email.split('@')[0], // Placeholder name, teacher can update later
            email: email,
            schoolId: invite.adminId,
            primarySubject: 'General',
            isClassTeacher: false,
            assignedSubjects: []
          });

          // Cleanup invite (optional)
          // await dbService.deleteTeacherInvite(email);

          onAuthSuccess(uid);
        } else {
          // Standard Admin flow
          if (!schoolName) {
            setError('School name is required for new Admin signup.');
            setLoading(false);
            return;
          }
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const uid = userCredential.user.uid;
          await dbService.createAdminProfile(uid, email);
          await dbService.createSchool(uid, { name: schoolName });
          onAuthSuccess(uid);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 shadow-2xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl mx-auto mb-6 flex items-center justify-center text-white text-3xl font-black">G</div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-2 uppercase tracking-tight">
            {activeRole ? `${activeRole} Login` : (isLogin ? 'Welcome Back' : 'Get Started')}
          </h2>
          <p className="text-slate-500 font-medium capitalize">
            {isLogin ? `${activeRole?.toLowerCase() || 'Your'} account access` : 'Create your school account'}
          </p>
          {activeRole !== 'ADMIN' && !isLogin && (
            <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 rounded-2xl text-amber-700 dark:text-amber-400 text-xs font-bold">
              ⚠️ Only School Administrators can create new accounts. Teachers and students are added by their respective school.
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="space-y-2">
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">School Name</label>
              <input
                className="input-style"
                placeholder="Ex: Ivy League Academy"
                value={schoolName}
                onChange={e => setSchoolName(e.target.value)}
                required={!isLogin}
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Email Address</label>
            <input
              type="email"
              className="input-style"
              placeholder="admin@school.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Password</label>
            <input
              type="password"
              className="input-style"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-2xl text-red-600 dark:text-red-400 text-sm font-bold animate-shake">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black shadow-xl shadow-indigo-200 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              isLogin ? 'Login Dashboard' : 'Create Account'
            )}
          </button>
        </form>

        {activeRole === 'ADMIN' && (
          <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-700 text-center">
            <p className="text-slate-500 font-medium mb-4">
              {isLogin ? "New School?" : "Already Registered?"}
            </p>
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-indigo-600 dark:text-indigo-400 font-black hover:underline underline-offset-4"
            >
              {isLogin ? 'Register Your School' : 'Back to Admin Login'}
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => window.location.href = '/'}
            className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors"
          >
            ← Back to Role Selection
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
