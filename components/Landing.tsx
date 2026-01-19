
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const roles = [
    {
      id: 'ADMIN',
      title: 'School Administrator',
      desc: 'Register and manage your school, grades, and teachers.',
      icon: '🏢',
      color: 'bg-indigo-600'
    },
    {
      id: 'TEACHER',
      title: 'Teacher Portal',
      desc: 'Access your assignments, gradebooks, and student lists.',
      icon: '👩‍🏫',
      color: 'bg-emerald-600'
    },
    {
      id: 'STUDENT',
      title: 'Student Area',
      desc: 'View your tasks, submit answers, and check AI feedback.',
      icon: '🎓',
      color: 'bg-amber-600'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 p-6 relative">
      <button
        onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
        className="absolute top-6 right-6 w-10 h-10 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl flex items-center justify-center hover:bg-slate-50 transition-colors"
        aria-label="Toggle theme"
        title="Toggle theme"
      >
        {theme === 'dark' ? '🌙' : '☀️'}
      </button>
      <div className="text-center mb-16 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="w-20 h-20 bg-indigo-600 rounded-3xl mx-auto mb-8 flex items-center justify-center text-white text-4xl font-black shadow-2xl shadow-indigo-200 dark:shadow-none">G</div>
        <h1 className="text-5xl font-black text-slate-900 dark:text-white mb-4 tracking-tighter">
          Welcome to <span className="text-indigo-600">SmartGrader AI</span>
        </h1>
        <p className="text-slate-500 font-medium text-xl max-w-lg mx-auto leading-relaxed">
          The all-in-one AI platform for modern school grading and management.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full">
        {roles.map((role, idx) => (
          <div
            key={role.id}
            onClick={() => navigate(`/auth?role=${role.id}`)}
            className="group cursor-pointer bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-2xl hover:border-indigo-400 dark:hover:border-indigo-500 transition-all hover:-translate-y-2 animate-in fade-in zoom-in duration-500"
            style={{ animationDelay: `${idx * 150}ms` }}
          >
            <div className={`w-16 h-16 ${role.color} rounded-2xl flex items-center justify-center text-3xl mb-8 group-hover:scale-110 transition-transform shadow-lg shadow-current/20`}>
              {role.icon}
            </div>
            <h3 className="text-2xl font-black mb-4 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{role.id}</h3>
            <p className="text-slate-500 font-medium dark:text-slate-300 leading-relaxed mb-8">
              {role.desc}
            </p>
            <div className={`inline-flex items-center gap-2 font-black text-sm uppercase tracking-widest ${role.color.replace('bg-', 'text-')} group-hover:translate-x-2 transition-transform`}>
              Navigate to {role.id.toLowerCase()} →
            </div>
          </div>
        ))}
      </div>

      <div className="mt-20 text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">
        Empowering {new Date().getFullYear()} Educators with AI
      </div>
    </div>
  );
};

export default Landing;
