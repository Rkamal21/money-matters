import { useState, useEffect } from 'react';
import './App.css';
import {
  XP_PER_LEVEL,
  CATEGORIES,
  getCategoryIcon,
  isThisMonth,
  isToday,
} from './utils/constants';
import { inferCategoryFromText } from './utils/merchantCategory';
import { navIcons } from './components/NavIcons';
import { SplashScreen } from './components/SplashScreen';
import { AuthScreen } from './components/AuthScreen';
import { useAuth } from './hooks/useAuth';
import { useExpenses } from './hooks/useExpenses';
import { useGoals } from './hooks/useGoals';
import { useBudget } from './hooks/useBudget';
import { useProfile } from './hooks/useProfile';

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [showMenu, setShowMenu] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('moneyMattersTheme') || 'dark');

  // Auth
  const { user, loading: authLoading, signUp, signIn, signOut } = useAuth();

  // Data hooks (only active when user is logged in)
  const { expenses, addExpense: addExpenseToDb, deleteExpense: deleteExpenseFromDb } = useExpenses(user);
  const { goals, addGoal: addGoalToDb, deleteGoal: deleteGoalFromDb, depositToGoal: depositToGoalInDb } = useGoals(user);
  const { budget, updateBudgetField } = useBudget(user);
  const { profile, addXpAndUpdateStreak } = useProfile(user);

  // Controlled form for new expense
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Food');

  const xp = profile.xp;
  const streak = profile.streak;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpProgress = xp % XP_PER_LEVEL;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('moneyMattersTheme', theme);
  }, [theme]);

  const addExpense = async (amount, desc, category) => {
    const result = await addExpenseToDb(amount, desc, category);
    if (result?.data) {
      await addXpAndUpdateStreak();
      setExpenseAmount('');
      setExpenseDesc('');
      setExpenseCategory('Food');
    }
  };

  const safeDaily = Math.max(
    0,
    Math.floor((Number(budget.income) - Number(budget.fixed) - Number(budget.savings)) / 30)
  );
  const todaySpent = expenses
    .filter((e) => isToday(e.date))
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const monthSpent = expenses
    .filter((e) => isThisMonth(e.date))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const byCategory = expenses.reduce((acc, e) => {
    const cat = e.category || 'Other';
    acc[cat] = (acc[cat] || 0) + Number(e.amount);
    return acc;
  }, {});
  const totalSpent = Object.values(byCategory).reduce((s, n) => s + n, 0);

  const handleLogout = async () => {
    await signOut();
    setShowMenu(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <div className="content">
            <div className="card summary-card">
              <h3>📊 Quick summary</h3>
              <div className="summary-row">
                <span>Today</span>
                <strong>₹{todaySpent.toLocaleString()}</strong>
              </div>
              <div className="summary-row">
                <span>This month</span>
                <strong>₹{monthSpent.toLocaleString()}</strong>
              </div>
              {safeDaily > 0 && (
                <div className="summary-row highlight">
                  <span>Daily budget</span>
                  <strong>₹{safeDaily.toLocaleString()}</strong>
                </div>
              )}
            </div>

            <div className="card">
              <h3>Quick Add Expense</h3>
              <input
                type="number"
                placeholder="Amount (₹)"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
              />
              <input
                type="text"
                placeholder="Description"
                value={expenseDesc}
                onChange={(e) => setExpenseDesc(e.target.value)}
                onBlur={() => {
                  const inferred = inferCategoryFromText(expenseDesc);
                  if (inferred) setExpenseCategory(inferred);
                }}
              />
              <select
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                className="add-btn"
                onClick={() => addExpense(expenseAmount, expenseDesc, expenseCategory)}
              >
                Add Expense
              </button>
            </div>

            <div className="card">
              <h3>Recent Expenses</h3>
              {expenses.slice(0, 15).map((e) => (
                <div key={e.id} className="expense-item">
                  <div>
                    <span className="expense-icon">{getCategoryIcon(e.category)}</span>
                    <strong>₹{Number(e.amount).toLocaleString()}</strong>
                    {e.description && ` – ${e.description}`}
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => deleteExpenseFromDb(e.id)}
                    title="Delete"
                    aria-label="Delete"
                  >
                    🗑️
                  </button>
                </div>
              ))}
              {expenses.length === 0 && (
                <p className="empty-state">No expenses yet. Add one above!</p>
              )}
            </div>
          </div>
        );

      case 'goals':
        return (
          <div className="content">
            <div className="card">
              <h3>Add Goal</h3>
              <button
                className="add-btn"
                onClick={() => {
                  const name = prompt('Goal name');
                  const target = prompt('Target amount (₹)');
                  if (name != null && target != null) addGoalToDb(name, target);
                }}
              >
                + Create New Goal
              </button>
            </div>
            {goals.map((g) => (
              <div key={g.id} className="card goal-card">
                <div className="goal-header">
                  <strong>{g.name}</strong>
                  <button
                    className="delete-btn goal-delete"
                    onClick={() => deleteGoalFromDb(g.id)}
                    title="Delete goal"
                    aria-label="Delete goal"
                  >
                    ✕
                  </button>
                </div>
                <div className="goal-progress">
                  <span>₹{Number(g.current).toLocaleString()} / ₹{Number(g.target).toLocaleString()}</span>
                </div>
                <div className="xp-track" style={{ marginTop: 8 }}>
                  <div
                    className="xp-fill goal-fill"
                    style={{
                      width: `${Math.min(100, (g.target ? (g.current / g.target) * 100 : 0))}%`,
                    }}
                  />
                </div>
                <div className="deposit-row">
                  <input
                    type="number"
                    placeholder="Amount"
                    className="deposit-input"
                    id={`deposit-${g.id}`}
                    min="1"
                  />
                  <button
                    className="deposit-btn"
                    onClick={() => {
                      const input = document.getElementById(`deposit-${g.id}`);
                      const val = input?.value;
                      if (val) {
                        depositToGoalInDb(g.id, val);
                        if (input) input.value = '';
                      }
                    }}
                  >
                    Deposit
                  </button>
                </div>
                <div className="quick-deposits">
                  {[100, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className="quick-deposit"
                      onClick={() => depositToGoalInDb(g.id, amt)}
                    >
                      +₹{amt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {goals.length === 0 && (
              <div className="card">
                <p className="empty-state">No goals yet. Create one to start saving!</p>
              </div>
            )}
          </div>
        );

      case 'habits':
        return (
          <div className="content">
            <div className="card">
              <h3>📊 Spending by category</h3>
              {totalSpent > 0 ? (
                <>
                  <div className="habits-total">
                    Total spent: <strong>₹{totalSpent.toLocaleString()}</strong>
                  </div>
                  <ul className="habits-list">
                    {Object.entries(byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, amount]) => (
                        <li key={cat} className="habit-row">
                          <span className="habit-icon">{getCategoryIcon(cat)}</span>
                          <span className="habit-label">{cat}</span>
                          <span className="habit-amount">₹{amount.toLocaleString()}</span>
                          <div
                            className="habit-bar"
                            style={{
                              width: `${totalSpent ? (amount / totalSpent) * 100 : 0}%`,
                            }}
                          />
                        </li>
                      ))}
                  </ul>
                </>
              ) : (
                <p className="empty-state">Add expenses to see your spending habits here.</p>
              )}
            </div>
            <div className="card">
              <h3>This month</h3>
              <p className="habits-month">₹{monthSpent.toLocaleString()}</p>
            </div>
          </div>
        );

      case 'budget':
        return (
          <div className="content">
            <div className="card">
              <h3>Budget Settings</h3>
              <label className="input-label">Monthly income (₹)</label>
              <input
                type="number"
                placeholder="Monthly Income"
                value={budget.income || ''}
                onChange={(e) => updateBudgetField('income', e.target.value)}
                min="0"
              />
              <label className="input-label">Fixed expenses (₹)</label>
              <input
                type="number"
                placeholder="Fixed Expenses"
                value={budget.fixed || ''}
                onChange={(e) => updateBudgetField('fixed', e.target.value)}
                min="0"
              />
              <label className="input-label">Savings goal (₹)</label>
              <input
                type="number"
                placeholder="Savings Goal"
                value={budget.savings || ''}
                onChange={(e) => updateBudgetField('savings', e.target.value)}
                min="0"
              />
            </div>
            <div className="card highlight-card">
              <h3>Safe daily limit</h3>
              <p className="safe-daily">₹{safeDaily.toLocaleString()}</p>
              <p className="safe-daily-hint">Spend under this per day to stay on track.</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className={`app ${theme}`}>
        {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      </div>
    );
  }

  // Show auth screen if not logged in
  if (!user) {
    return (
      <div className={`app ${theme}`}>
        {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
        {!showSplash && <AuthScreen signUp={signUp} signIn={signIn} />}
      </div>
    );
  }

  return (
    <div className={`app ${theme}`}>
      {showSplash && (
        <SplashScreen onComplete={() => setShowSplash(false)} />
      )}
      <div className="top-bar">
        <button
          type="button"
          className="menu-btn"
          onClick={() => setShowMenu(!showMenu)}
          aria-label="Menu"
        >
          ☰
        </button>
        <span className="top-title">Track smart. Save smarter.</span>
        <button
          type="button"
          className="theme-btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      {showMenu && (
        <div
          className="menu-overlay"
          onClick={() => setShowMenu(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Escape' && setShowMenu(false)}
          aria-label="Close menu"
        >
          <div className="side-menu" onClick={(e) => e.stopPropagation()}>
            <div className="menu-header">
              <h2>💰 Money Matters</h2>
              <p>{user.email}</p>
            </div>
            <div className="menu-items">
              <button type="button" onClick={() => { setActiveTab('home'); setShowMenu(false); }}>
                🏠 Home
              </button>
              <button type="button" onClick={() => { setActiveTab('goals'); setShowMenu(false); }}>
                🎯 Goals
              </button>
              <button type="button" onClick={() => { setActiveTab('habits'); setShowMenu(false); }}>
                📊 Habits
              </button>
              <button type="button" onClick={() => { setActiveTab('budget'); setShowMenu(false); }}>
                ⚙️ Budget
              </button>
            </div>
            <div className="menu-footer">
              <div className="theme-toggle">
                <span>Theme</span>
                <div className="theme-buttons">
                  <button
                    type="button"
                    className={theme === 'light' ? 'active' : ''}
                    onClick={() => setTheme('light')}
                  >
                    ☀️ Light
                  </button>
                  <button
                    type="button"
                    className={theme === 'dark' ? 'active' : ''}
                    onClick={() => setTheme('dark')}
                  >
                    🌙 Dark
                  </button>
                </div>
              </div>
              <button type="button" className="logout-btn" onClick={handleLogout}>
                🚪 Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="xp-bar">
        <div className="xp-header">
          <span className="xp-label">⭐ Level {level}</span>
          <span className="xp-value">{streak > 0 && `🔥 ${streak} day streak · `}{xp} XP</span>
        </div>
        <div className="xp-track">
          <div className="xp-fill" style={{ width: `${xpProgress}%` }} />
        </div>
      </div>

      <div className="main-content">{renderContent()}</div>

      <nav className="tabs" aria-label="Main navigation">
        {[
          { id: 'home', label: 'Home' },
          { id: 'goals', label: 'Goals' },
          { id: 'habits', label: 'Habits' },
          { id: 'budget', label: 'Budget' },
        ].map(({ id, label }) => {
          const Icon = navIcons[id];
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              className={`tab ${active ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="tab-icon">{Icon && <Icon active={active} />}</span>
              <span className="tab-label">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default App;
