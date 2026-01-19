
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { auth } from './services/firebase';
import { dbService } from './services/dbService';
import { UserRole, Assignment, Submission } from './types';
import TeacherDashboard from './components/TeacherDashboard';
import AdminDashboard from './components/AdminDashboard';
import StudentDashboard from './components/StudentDashboard';
import Auth from './components/Auth';
import Landing from './components/Landing';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        try {
          const profile = await dbService.getUserProfile(u.uid);
          if (profile) {
            setUserProfile(profile);
            setRole(profile.role as UserRole);
          } else {
            // Fallback or handle missing profile
            setRole(UserRole.ADMIN);
          }
        } catch (err) {
          console.error("Error fetching profile:", err);
          setRole(UserRole.ADMIN);
        }
      } else {
        setUser(null);
        setRole(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={!user ? <Auth onAuthSuccess={() => { }} /> : <Navigate to="/" replace />} />

        {/* Protected Routes */}
        <Route path="/admin/*" element={
          <ProtectedRoute user={user} role={role} allowedRole={UserRole.ADMIN}>
            <DashboardLayout user={user!} role={role!}>
              <AdminDashboard adminId={user?.uid!} />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        <Route path="/teacher/*" element={
          <ProtectedRoute user={user} role={role} allowedRole={UserRole.TEACHER}>
            <DashboardLayout user={user!} role={role!}>
              <TeacherDashboard
                teacherId={user?.uid!}
                adminId={userProfile?.adminId}
              />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        <Route path="/student/*" element={
          <ProtectedRoute user={user} role={role} allowedRole={UserRole.STUDENT}>
            <DashboardLayout user={user!} role={role!}>
              <StudentDashboard
                studentId={user?.uid!}
                adminId={userProfile?.adminId}
                classId={userProfile?.classId}
              />
            </DashboardLayout>
          </ProtectedRoute>
        } />

        {/* Redirects */}
        <Route path="/" element={
          user ? (
            role === UserRole.ADMIN ? <Navigate to="/admin" replace /> :
              role === UserRole.TEACHER ? <Navigate to="/teacher" replace /> :
                <Navigate to="/student" replace />
          ) : <Landing />
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

const ProtectedRoute: React.FC<{
  user: User | null,
  role: UserRole | null,
  allowedRole: UserRole,
  children: React.ReactNode
}> = ({ user, role, allowedRole, children }) => {
  const location = useLocation();

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (role !== allowedRole) {
    // Redirect to their own dashboard if they try to access another role's path
    const target = role === UserRole.ADMIN ? '/admin' : role === UserRole.TEACHER ? '/teacher' : '/student';
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};

const DashboardLayout: React.FC<{ user: User, role: UserRole, children: React.ReactNode }> = ({ user, role, children }) => {
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

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/auth');
  };

  const handleThemeToggle = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-200 transition-all duration-500">
      <nav className="sticky top-0 z-[100] px-8 py-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl">
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black group-hover:rotate-12 transition-all">G</div>
            <span className="text-xl font-black tracking-tighter">SmartGrader<span className="text-indigo-600">AI</span></span>
          </div>

          <div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-700 p-1.5 rounded-2xl gap-1">
            {role === UserRole.ADMIN && (
              <>
                <NavTab to="/admin" label="Overview" icon="📊" end />
                <NavTab to="/admin/teachers" label="Teachers" icon="👩‍🏫" />
                <NavTab to="/admin/structure" label="Structure" icon="🏫" />
              </>
            )}
            {role === UserRole.TEACHER && (
              <>
                <NavTab to="/teacher" label="Overview" icon="📊" end />
                <NavTab to="/teacher/assignments" label="Assignments" icon="📝" />
                <NavTab to="/teacher/notes" label="Notes" icon="🗒️" />
                <NavTab to="/teacher/grades" label="Gradebook" icon="🎓" />
                <NavTab to="/teacher/students" label="Students" icon="👥" />
              </>
            )}
            {role === UserRole.STUDENT && (
              <>
                <NavTab to="/student" label="My Tasks" icon="📥" end />
                <NavTab to="/student/grades" label="My Grades" icon="🏆" />
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="h-10 px-4 flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">
              {role.toLowerCase()} Mode
            </span>
          </div>
          <button
            onClick={handleThemeToggle}
            className="w-10 h-10 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl flex items-center justify-center hover:bg-slate-50 transition-colors"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <button
            onClick={handleLogout}
            className="w-10 h-10 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl flex items-center justify-center hover:bg-slate-50 transition-colors text-red-500 dark:text-red-400"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-red-500 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 4h-3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
              <path d="M16 12H9" />
              <path d="M13 9l3 3-3 3" />
            </svg>
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-12">
        {children}
      </main>
    </div>
  );
};

const NavTab: React.FC<{ to: string, label: string, icon: string, end?: boolean }> = ({ to, label, icon, end }) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) => `flex items-center gap-2.5 px-6 py-3 rounded-xl text-sm font-bold transition-all ${isActive
      ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-xl shadow-indigo-100 dark:shadow-none'
      : 'text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-200'
      }`}
  >
    <span>{icon}</span>
    {label}
  </NavLink>
);

export default App;
