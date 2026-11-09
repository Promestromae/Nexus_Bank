import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CarFront,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  House,
  Landmark,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import { fetchStatement, fetchState, resetState, submitPayment, updateCard } from "./api";
import type { PaymentRequest } from "./api";
import type { AccountId, SimulationState, Transaction } from "./types";

type Section = "Overview" | "Accounts" | "Payments" | "Cards" | "Budget" | "Credit";
type PaymentType = "payment" | "transfer" | "repayment";

const navigation: { name: Section; icon: typeof House }[] = [
  { name: "Overview", icon: House },
  { name: "Accounts", icon: Wallet },
  { name: "Payments", icon: ArrowLeftRight },
  { name: "Cards", icon: CreditCard },
  { name: "Budget", icon: SlidersHorizontal },
  { name: "Credit", icon: TrendingUp },
];

const kes = (amount: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(amount);

const nextCreditPaymentDate = () => {
  const today = new Date();
  const dueDate = new Date(today.getFullYear(), today.getMonth(), 25);
  if (today.getDate() > 25) dueDate.setMonth(dueDate.getMonth() + 1);
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "long", year: "numeric" }).format(dueDate);
};

type PaymentDraft = {
  request: PaymentRequest;
  beneficiaryLabel: string;
};

function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [showBalances, setShowBalances] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>("payment");
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetchState()
      .then((state) => {
        if (active) {
          setSimulation(state);
          setBackendError("");
        }
      })
      .catch((error: unknown) => {
        if (active) setBackendError(error instanceof Error ? error.message : "The bank service is unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (!simulation) {
    return (
      <div className="service-screen">
        <div className="service-card">
          <span className="brand-mark"><Landmark size={21} /></span>
          <h1>{loading ? "Connecting to Nexus Bank" : "Bank service unavailable"}</h1>
          <p>{loading ? "Loading your accounts…" : backendError || "The banking service could not be reached."}</p>
          {!loading && <><p className="service-help">Start the API with <code>npm run server</code>, then try again.</p><button className="primary-button" onClick={() => window.location.reload()}>Retry connection</button></>}
        </div>
      </div>
    );
  }

  const checking = simulation.balances.everyday;
  const savings = simulation.balances.savings;
  const creditBalance = simulation.creditBalance;
  const transactions = simulation.transactions;
  const now = new Date();
  const monthlySpending = transactions
    .filter((transaction) => {
      const date = new Date(transaction.createdAt);
      return transaction.amount < 0 && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    })
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  const openPayment = (type: PaymentType = "payment") => {
    setPaymentType(type);
    setPaymentDraft(null);
    setTransferOpen(true);
  };

  const reviewPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const typeValue = formData.get("type");
    const type = typeValue === "transfer" || typeValue === "repayment" ? typeValue : "payment";
    const beneficiary = String(formData.get("beneficiary") ?? "").trim();
    const reference = String(formData.get("reference") ?? "").trim() || "Payment";
    const rawAmount = Number(formData.get("amount"));
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      setNotice("Enter a valid payment amount.");
      return;
    }
    const amountInCents = Math.round(rawAmount * 100);
    const amount = amountInCents / 100;
    const source = formData.get("source") === "savings" ? "savings" : "everyday";
    const destinationValue = formData.get("destination");
    const destination: AccountId | "beneficiary" | "credit" = type === "payment"
      ? "beneficiary"
      : type === "repayment"
        ? "credit"
        : destinationValue === "everyday" || destinationValue === "savings"
          ? destinationValue
          : "beneficiary";
    if ((type === "payment" && !beneficiary) || (type === "repayment" && amount > simulation.creditBalance)) {
      setNotice(type === "payment" ? "Enter a beneficiary and a valid amount." : "That amount is more than your outstanding credit balance.");
      return;
    }
    if (type === "transfer" && (destination === "beneficiary" || destination === "credit" || destination === source)) {
      setNotice("Choose a different destination account.");
      return;
    }
    if (amount > simulation.balances[source]) {
      setNotice("Your available balance is not enough for this payment.");
      return;
    }
    if (destination === "credit") {
      setPaymentDraft({
        request: { kind: "repayment", amount, reference, source },
        beneficiaryLabel: "Nexus credit account",
      });
    } else if (destination !== "beneficiary") {
      setPaymentDraft({
        request: {
          kind: "transfer",
          amount,
          reference,
          source,
          destination,
        },
        beneficiaryLabel: destination === "savings" ? "GoalSave" : "Everyday account",
      });
    } else {
      setPaymentDraft({
        request: { kind: "payment", beneficiary, amount, reference, source },
        beneficiaryLabel: beneficiary,
      });
    }
  };

  const confirmPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentDraft) return;
    setSubmitting(true);
    try {
      const state = await submitPayment(paymentDraft.request);
      setSimulation(state);
      setTransferOpen(false);
      setPaymentDraft(null);
      const { amount, kind } = paymentDraft.request;
      setNotice(kind === "payment"
        ? `Payment of ${kes(amount)} to ${paymentDraft.beneficiaryLabel} sent.`
        : kind === "repayment"
          ? `Credit repayment of ${kes(amount)} complete.`
          : `Transfer of ${kes(amount)} to ${paymentDraft.beneficiaryLabel} complete.`);
      window.setTimeout(() => setNotice(""), 4000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The server could not complete the payment.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetDemo = async () => {
    try {
      if (!window.confirm("Reset balances and transaction history to their starting values?")) return;
      const state = await resetState();
      setSimulation(state);
      setNotice("Simulation data reset to its starting balances.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not reset the simulation.");
    }
  };

  const changeCard = async (update: { frozen?: boolean; dailyLimit?: number }, successMessage: string) => {
    try {
      setSimulation(await updateCard(update));
      setNotice(successMessage);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update card settings.");
    }
  };

  const downloadStatement = async (accountId?: AccountId) => {
    try {
      const blob = await fetchStatement(accountId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nexus-${accountId ?? "all-accounts"}-statement.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Your statement has been downloaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not download the statement.");
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark"><Landmark size={21} strokeWidth={2.2} /></span>
          <span>Nexus<span className="brand-light">bank</span></span>
        </a>
        <div className="profile-switch">
          <div className="avatar">WS</div>
          <div className="profile-copy"><strong>Will Scott</strong><span>Personal banking</span></div>
          <ChevronDown size={16} className="muted-icon" />
        </div>
        <span className="nav-label">YOUR BANK</span>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }) => (
            <button key={name} className={`nav-item ${section === name ? "active" : ""}`} onClick={() => { setSection(name); setMenuOpen(false); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{name}</span>
              {name === "Payments" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon"><CircleHelp size={17} /></span>
            <strong>Need a hand?</strong>
            <p>We’re here to help, anytime.</p>
            <button onClick={() => setNotice("Support is available in this app experience.")}>Visit help centre <ArrowRight size={14} /></button>
          </div>
          <button className="nav-item utility-item" onClick={resetDemo}><Settings size={18} />Reset simulation</button>
          <button className="nav-item utility-item" onClick={() => setNotice("This local simulation does not have a sign-in session.")}><LogOut size={18} />Sign out</button>
          <div className="sidebar-foot">© {new Date().getFullYear()} Nexus Bank <span>·</span> Kenya</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button>
          <div className="breadcrumb">My banking <ChevronRight size={14} /> <strong>{section}</strong></div>
          <div className="topbar-actions">
            <button className="icon-button search-button" aria-label="Search" onClick={() => setNotice("Search is coming soon.")}><Search size={19} /></button>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up on notifications.")}><Bell size={19} /><i /></button>
            <span className="top-divider" />
            <button className="top-profile" onClick={() => setNotice("Profile settings are coming soon.")}><span className="avatar avatar-small">WS</span><ChevronDown size={15} /></button>
          </div>
        </header>

        <div className="page-content">
          {section === "Overview" ? (
            <Overview
              checking={checking}
              savings={savings}
              spent={monthlySpending}
              showBalances={showBalances}
              onToggleBalances={() => setShowBalances((value) => !value)}
              onTransfer={(type = "payment") => openPayment(type)}
              onNavigate={setSection}
              transactions={transactions}
            />
          ) : (
            <SectionPage
              section={section}
              checking={checking}
              savings={savings}
              showBalances={showBalances}
              spent={monthlySpending}
              creditBalance={creditBalance}
              cardFrozen={simulation.cardFrozen}
              cardLimit={simulation.cardLimit}
              transactions={transactions}
              onToggleBalances={() => setShowBalances((value) => !value)}
              onTransfer={(type = "payment") => openPayment(type)}
              onNavigate={setSection}
              onDownloadStatement={downloadStatement}
              onSetCardFrozen={(cardFrozen) => void changeCard({ frozen: cardFrozen }, cardFrozen ? "Your card has been frozen." : "Your card has been unfrozen.")}
              onSetCardLimit={(cardLimit) => void changeCard({ dailyLimit: cardLimit }, "Your daily card limit has been updated.")}
            />
          )}
        </div>
      </main>
      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
      {transferOpen && <TransferModal onClose={() => { if (!submitting) { setTransferOpen(false); setPaymentDraft(null); setNotice(""); } }} onReview={reviewPayment} onSubmit={confirmPayment} paymentDraft={paymentDraft} balances={simulation.balances} creditBalance={creditBalance} initialType={paymentType} submitting={submitting} />}
    </div>
  );
}

function Overview(props: {
  checking: number;
  savings: number;
  spent: number;
  showBalances: boolean;
  onToggleBalances: () => void;
  onTransfer: (type?: "payment" | "transfer") => void;
  onNavigate: (section: Section) => void;
  transactions: Transaction[];
}) {
  const { checking, savings, spent, showBalances, onToggleBalances, onTransfer, onNavigate, transactions } = props;
  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">{new Intl.DateTimeFormat("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).toUpperCase()}</p><h1>Good morning, Will <span className="wave">✦</span></h1><p className="welcome-sub">Here’s what’s happening with your money.</p></div>
        <button className="date-button"><span className="status-dot" /> All accounts up to date <ChevronDown size={15} /></button>
      </div>
      <section className="balance-grid">
        <article className="balance-card primary-card">
          <div className="card-heading"><span>Total balance</span><button aria-label={showBalances ? "Hide balances" : "Show balances"} onClick={onToggleBalances}>{showBalances ? <Eye size={17} /> : <EyeOff size={17} />}</button></div>
          <div className="total-amount">{showBalances ? kes(checking + savings) : "KSh ••••••"}</div>
          <div className="balance-caption"><span className="up-pill"><TrendingUp size={13} /> 4.8%</span> <span>vs. last month</span></div>
          <div className="account-breakdown">
            <div><span className="breakdown-dot checking-dot" /><span>Everyday account</span><strong>{showBalances ? kes(checking) : "KSh •••••"}</strong></div>
            <div><span className="breakdown-dot savings-dot" /><span>GoalSave</span><strong>{showBalances ? kes(savings) : "KSh •••••"}</strong></div>
          </div>
        </article>
        <article className="mini-balance">
          <div className="mini-card-top"><span className="mini-icon lavender"><Wallet size={18} /></span><button aria-label="More account options"><MoreHorizontal size={19} /></button></div>
          <span className="mini-label">EVERYDAY ACCOUNT</span>
          <strong className="mini-amount">{showBalances ? kes(checking) : "KSh ••••••"}</strong>
          <span className="account-number">•••• 4829 <span className="account-type">Transactional</span></span>
          <button className="mini-link" onClick={() => onNavigate("Accounts")}>View account <ArrowRight size={14} /></button>
        </article>
        <article className="mini-balance">
          <div className="mini-card-top"><span className="mini-icon mint"><Sparkles size={18} /></span><button aria-label="More account options"><MoreHorizontal size={19} /></button></div>
          <span className="mini-label">GOALSAVE</span>
          <strong className="mini-amount">{showBalances ? kes(savings) : "KSh ••••••"}</strong>
          <span className="account-number">•••• 1036 <span className="account-type">Savings</span></span>
          <button className="mini-link" onClick={() => onNavigate("Accounts")}>View account <ArrowRight size={14} /></button>
        </article>
      </section>

      <section className="quick-actions">
        <div className="section-title"><h2>Quick actions</h2><span>Your everyday banking, made easy</span></div>
        <div className="action-grid">
          <button className="action-card" onClick={() => onTransfer("payment")}><span className="action-icon action-purple"><Send size={18} /></span><span><strong>Pay someone</strong><small>Make a payment</small></span><ArrowRight className="action-arrow" size={16} /></button>
          <button className="action-card" onClick={() => onTransfer("transfer")}><span className="action-icon action-peach"><ArrowLeftRight size={18} /></span><span><strong>Transfer</strong><small>Between your accounts</small></span><ArrowRight className="action-arrow" size={16} /></button>
          <button className="action-card" onClick={() => onNavigate("Cards")}><span className="action-icon action-blue"><CreditCard size={18} /></span><span><strong>My cards</strong><small>Manage your cards</small></span><ArrowRight className="action-arrow" size={16} /></button>
          <button className="action-card" onClick={() => onNavigate("Accounts")}><span className="action-icon action-green"><Plus size={19} /></span><span><strong>Open account</strong><small>Find your next account</small></span><ArrowRight className="action-arrow" size={16} /></button>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel transactions-panel">
          <div className="panel-header"><div><h2>Recent transactions</h2><p>Your latest account activity</p></div><button className="text-button" onClick={() => onNavigate("Accounts")}>View all <ArrowRight size={15} /></button></div>
          <div className="transaction-list">
            {transactions.slice(0, 5).map((transaction, index) => <TransactionRow key={`${transaction.name}-${index}`} transaction={transaction} />)}
          </div>
        </article>
        <div className="right-column">
          <article className="panel spending-panel">
            <div className="panel-header"><div><h2>Spending this month</h2><p>{new Intl.DateTimeFormat("en-KE", { month: "long" }).format(new Date())}</p></div><button className="more-button" aria-label="Spending options"><MoreHorizontal size={20} /></button></div>
            <div className="spend-total">{kes(spent)}<span> of KSh 12,000</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min((spent / 12000) * 100, 100)}%` }} /></div>
            <div className="spend-caption"><span><span className="tiny-dot" />Monthly budget</span><strong>{Math.max(12000 - spent, 0).toLocaleString("en-KE", { style: "currency", currency: "KES" })} left</strong></div>
            <div className="spend-chart" aria-label="Spending over the last seven days">
              {[34, 52, 40, 73, 48, 62, 44, 80, 57, 68, 45, 59, 38, 72].map((height, index) => <span key={index} className={index === 13 ? "chart-bar current" : "chart-bar"} style={{ height: `${height}%` }} />)}
            </div>
            <div className="chart-labels"><span>1 Jun</span><span>Today</span></div>
            <button className="budget-link" onClick={() => onNavigate("Budget")}>See spending breakdown <ArrowRight size={14} /></button>
          </article>
          <article className="insight-card">
            <div className="insight-spark"><Sparkles size={17} /></div><div className="insight-copy"><strong>You’re doing great, Will!</strong><p>You’ve saved 12% more this month. Keep it up.</p></div><button aria-label="View savings" onClick={() => onNavigate("Budget")}><ArrowRight size={17} /></button>
          </article>
        </div>
      </section>
      <div className="secure-note"><ShieldCheck size={15} /> Your banking is protected with secure encryption.</div>
    </>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const icon = {
    shopping: <ShoppingBag size={17} />,
    food: <Utensils size={17} />,
    car: <CarFront size={17} />,
    salary: <BriefcaseBusiness size={17} />,
    transfer: <ArrowUpRight size={17} />,
  }[transaction.category];
  return (
    <div className="transaction-row">
      <span className={`transaction-icon icon-${transaction.category}`}>{icon}</span>
      <span className="transaction-name"><strong>{transaction.name}</strong><small>{transaction.detail}</small></span>
      <span className={`transaction-amount ${transaction.amount > 0 ? "positive" : ""}`}>{transaction.amount > 0 ? "+" : "−"}{kes(Math.abs(transaction.amount))}</span>
    </div>
  );
}

function SectionPage(props: {
  section: Section;
  checking: number;
  savings: number;
  creditBalance: number;
  cardFrozen: boolean;
  cardLimit: number;
  showBalances: boolean;
  spent: number;
  transactions: Transaction[];
  onToggleBalances: () => void;
  onTransfer: (type?: PaymentType) => void;
  onNavigate: (section: Section) => void;
  onDownloadStatement: (accountId?: AccountId) => void;
  onSetCardFrozen: (frozen: boolean) => void;
  onSetCardLimit: (limit: number) => void;
}) {
  const { section, checking, savings, creditBalance, cardFrozen, cardLimit, showBalances, spent, transactions, onToggleBalances, onTransfer, onNavigate, onDownloadStatement, onSetCardFrozen, onSetCardLimit } = props;
  const [accountFilter, setAccountFilter] = useState<"all" | AccountId>("all");
  const [limitDraft, setLimitDraft] = useState(String(cardLimit));
  const [limitError, setLimitError] = useState("");
  const now = new Date();
  const currentMonthTransactions = transactions.filter((transaction) => {
    const date = new Date(transaction.createdAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const categorySpending = (category: Transaction["category"]) => currentMonthTransactions
    .filter((transaction) => transaction.category === category && transaction.amount < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const descriptions: Record<Section, string> = {
    Overview: "Here’s what’s happening with your money.",
    Accounts: "Your accounts, balances and statements.",
    Payments: "Pay a beneficiary or move money between accounts.",
    Cards: "Your cards, all in one place.",
    Budget: "A clearer picture of where your money goes.",
    Credit: "Manage your credit and repayments.",
  };
  return (
    <>
      <div className="welcome-row section-welcome"><div><p className="eyebrow">YOUR MONEY, IN MOTION</p><h1>{section}</h1><p className="welcome-sub">{descriptions[section]}</p></div>
        {section === "Payments" && <button className="primary-button" onClick={() => onTransfer("payment")}><Send size={16} /> Make a payment</button>}
      </div>
      {section === "Accounts" && (
        <>
          <div className="section-cards">
            <article className="account-detail-card"><div className="detail-card-title"><span className="mini-icon lavender"><Wallet size={18} /></span><span>Everyday account <small>Transactional · •••• 4829</small></span><button onClick={onToggleBalances} aria-label="Toggle balances">{showBalances ? <Eye size={17} /> : <EyeOff size={17} />}</button></div><strong>{showBalances ? kes(checking) : "KSh ••••••"}</strong><span className="available-label">Available balance</span><button className="detail-action" onClick={() => onTransfer("transfer")}>Transfer money <ArrowRight size={15} /></button></article>
            <article className="account-detail-card"><div className="detail-card-title"><span className="mini-icon mint"><Sparkles size={18} /></span><span>GoalSave <small>Savings account · •••• 1036</small></span><button aria-label="Account options"><MoreHorizontal size={19} /></button></div><strong>{showBalances ? kes(savings) : "KSh ••••••"}</strong><span className="available-label">Available balance</span><button className="detail-action" onClick={() => onNavigate("Budget")}>View savings goals <ArrowRight size={15} /></button></article>
          </div>
          <article className="panel page-table"><div className="panel-header"><div><h2>Account activity</h2><p>Recent transactions across your accounts</p></div><div className="panel-actions"><select aria-label="Filter by account" className="compact-select" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value === "everyday" || event.target.value === "savings" ? event.target.value : "all")}><option value="all">All accounts</option><option value="everyday">Everyday account</option><option value="savings">GoalSave</option></select><button className="outline-button" onClick={() => onDownloadStatement(accountFilter === "all" ? undefined : accountFilter)}><Download size={15} /> Statement</button></div></div>{transactions.filter((transaction) => accountFilter === "all" || transaction.accountId === accountFilter).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} />)}</article>
        </>
      )}
      {section === "Payments" && <><div className="payment-shortcuts"><button className="shortcut-card" onClick={() => onTransfer("payment")}><span className="action-icon action-purple"><Send size={19} /></span><strong>Pay a beneficiary</strong><small>Send money to someone</small><ArrowRight size={16} /></button><button className="shortcut-card" onClick={() => onTransfer("transfer")}><span className="action-icon action-peach"><ArrowLeftRight size={19} /></span><strong>Between my accounts</strong><small>Move your money around</small><ArrowRight size={16} /></button></div><article className="panel page-table"><div className="panel-header"><div><h2>Payment history</h2><p>Your recent payments and transfers</p></div></div>{transactions.filter((transaction) => transaction.amount < 0).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} />)}</article></>}
      {section === "Cards" && <div className="cards-page-grid"><article className={`bank-card-visual ${cardFrozen ? "bank-card-frozen" : ""}`}><span className="card-brand">Nexus<span>bank</span></span><span className="card-chip" /><span className="card-number">•••• &nbsp; •••• &nbsp; •••• &nbsp; 4829</span><span className="card-bottom"><span>WILL SCOTT</span><span>VISA</span></span>{cardFrozen && <span className="frozen-stamp">CARD FROZEN</span>}</article><article className="panel card-controls"><h2>Everyday card</h2><p className="muted-copy">Linked to your Everyday account</p><div className="control-row"><span><strong>Card status</strong><small>{cardFrozen ? "Card payments are paused" : "Your card is ready to use"}</small></span><span className={cardFrozen ? "status-frozen" : "status-active"}><i />{cardFrozen ? "Frozen" : "Active"}</span></div><button className="outline-button card-toggle" onClick={() => onSetCardFrozen(!cardFrozen)}><CreditCard size={15} />{cardFrozen ? "Unfreeze card" : "Freeze card"}</button><form className="limit-form" onSubmit={(event) => { event.preventDefault(); const amount = Math.round(Number(limitDraft) * 100) / 100; if (!Number.isFinite(amount) || amount < 1 || amount > 100000) { setLimitError("Enter a limit between KSh 1 and KSh 100,000."); return; } setLimitError(""); onSetCardLimit(amount); }}><label className="field-label" htmlFor="card-limit">Daily card limit (KSh)<input id="card-limit" type="number" min="1" max="100000" step="1" value={limitDraft} onChange={(event) => { setLimitDraft(event.target.value); setLimitError(""); }} /></label>{limitError && <p className="form-error" role="alert">{limitError}</p>}<button className="outline-button" type="submit"><Settings size={15} /> Save limit</button></form></article></div>}
      {section === "Budget" && <><div className="budget-overview"><article className="panel budget-total-card"><span className="mini-label">TOTAL SPENT THIS MONTH</span><strong>{kes(spent)}</strong><span className="muted-copy">of KSh 12,000 monthly budget</span><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min((spent / 12000) * 100, 100)}%` }} /></div><span className="budget-remaining">{kes(Math.max(12000 - spent, 0))} remaining</span></article><article className="panel budget-total-card savings-card"><span className="mini-label">SAVINGS BALANCE</span><strong>{showBalances ? kes(savings) : "KSh ••••••"}</strong><span className="muted-copy">Your GoalSave balance</span><div className="savings-decoration"><TrendingUp size={22} /> You’re building a good habit.</div></article></div><article className="panel page-table"><div className="panel-header"><div><h2>Spending categories</h2><p>Your budget, at a glance</p></div><button className="outline-button"><Settings size={15} /> Edit budget</button></div><BudgetRow name="Groceries" spent={categorySpending("shopping")} limit={3500} color="purple" /><BudgetRow name="Transport" spent={categorySpending("car")} limit={1800} color="blue" /><BudgetRow name="Eating out" spent={categorySpending("food")} limit={1200} color="orange" /><BudgetRow name="Other payments" spent={categorySpending("transfer")} limit={800} color="green" /></article></>}
      {section === "Credit" && <><div className="credit-overview"><article className="credit-visual"><span className="card-brand">Nexus<span>credit</span></span><span className="credit-chip" /><span className="credit-amount">{showBalances ? kes(creditBalance) : "KSh ••••••"}</span><span className="credit-card-bottom"><span>AVAILABLE CREDIT&nbsp; {showBalances ? kes(50000 - creditBalance) : "KSh ••••••"}</span><span>•••• 7712</span></span></article><article className="panel credit-details"><span className="mini-label">CREDIT ACCOUNT</span><h2>Monthly overview</h2><div className="credit-line"><span>Credit limit</span><strong>{showBalances ? kes(50000) : "KSh ••••••"}</strong></div><div className="credit-line"><span>Current balance</span><strong>{showBalances ? kes(creditBalance) : "KSh ••••••"}</strong></div><div className="credit-line"><span>Next payment date</span><strong>{nextCreditPaymentDate()}</strong></div><button className="primary-button" onClick={() => onTransfer("repayment")} disabled={creditBalance === 0}>Make a payment <ArrowRight size={15} /></button></article></div><div className="credit-tip"><ShieldCheck size={18} /><span><strong>Stay on top of your credit</strong><small>Paying at least the minimum by your due date helps keep your account in good standing.</small></span></div></>}
    </>
  );
}

function BudgetRow({ name, spent, limit, color }: { name: string; spent: number; limit: number; color: string }) {
  return <div className="budget-row"><div className={`budget-category-icon ${color}`}><ShoppingBag size={17} /></div><div className="budget-row-main"><div className="budget-row-label"><strong>{name}</strong><span>{kes(spent)} <small>of {kes(limit)}</small></span></div><div className="progress-track"><div className={`progress-fill ${color}`} style={{ width: `${Math.min((spent / limit) * 100, 100)}%` }} /></div></div></div>;
}

function TransferModal({
  onClose,
  onReview,
  onSubmit,
  paymentDraft,
  balances,
  creditBalance,
  initialType,
  submitting,
}: {
  onClose: () => void;
  onReview: (event: FormEvent<HTMLFormElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  paymentDraft: PaymentDraft | null;
  balances: Record<AccountId, number>;
  creditBalance: number;
  initialType: PaymentType;
  submitting: boolean;
}) {
  const [type, setType] = useState<PaymentType>(initialType);
  const [source, setSource] = useState<AccountId>("everyday");
  const step = paymentDraft ? "confirm" : "form";
  const draftRequest = paymentDraft?.request ?? null;
  const amount = draftRequest?.amount ?? 0;
  const sourceName = draftRequest?.source === "savings" ? "GoalSave" : "Everyday account";
  const transferDestination: AccountId = source === "everyday" ? "savings" : "everyday";
  const heading = type === "payment" ? "Pay someone" : type === "transfer" ? "Transfer between accounts" : "Repay credit";
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
        <div className="modal-header"><div><span className="modal-kicker">{step === "form" ? "PAYMENTS" : "REVIEW PAYMENT"}</span><h2 id="transfer-title">{step === "form" ? heading : "Confirm payment"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={submitting}><X size={20} /></button></div>
        {step === "form" ? (
          <form onSubmit={onReview}>
            <label className="field-label" htmlFor="payment-type">What would you like to do?<select id="payment-type" name="type" value={type} onChange={(event) => setType(event.target.value === "transfer" || event.target.value === "repayment" ? event.target.value : "payment")}><option value="payment">Pay a beneficiary</option><option value="transfer">Transfer between my accounts</option><option value="repayment">Repay credit</option></select></label>
            <label className="field-label" htmlFor="source">From account<select id="source" name="source" value={source} onChange={(event) => setSource(event.target.value === "savings" ? "savings" : "everyday")}><option value="everyday">Everyday account · Available {kes(balances.everyday)}</option><option value="savings">GoalSave · Available {kes(balances.savings)}</option></select></label>
            {type === "payment" ? (
              <label className="field-label" htmlFor="beneficiary">Beneficiary<input id="beneficiary" name="beneficiary" placeholder="Name or account number" required /></label>
            ) : type === "transfer" ? (
              <label className="field-label">To account<div className="select-field"><span className="mini-icon mint"><Wallet size={17} /></span><span>{transferDestination === "savings" ? "GoalSave · •••• 1036" : "Everyday account · •••• 4829"}</span><ArrowLeftRight size={16} /></div><input type="hidden" name="destination" value={transferDestination} /></label>
            ) : (
              <div className="credit-repayment-note"><CreditCard size={16} /> Outstanding credit balance: <strong>{kes(creditBalance)}</strong></div>
            )}
            <label className="field-label" htmlFor="amount">Amount<input id="amount" name="amount" type="number" min="0.01" max={Math.min(balances[source], type === "repayment" ? creditBalance : balances[source])} step="0.01" placeholder="KSh 0.00" required /></label>
            <label className="field-label" htmlFor="reference">Payment reference<input id="reference" name="reference" placeholder="e.g. Rent, lunch" /></label>
            <button className="primary-button modal-submit" type="submit">Review payment <ArrowRight size={16} /></button>
            <p className="modal-footnote"><ShieldCheck size={14} /> Your payments are protected.</p>
          </form>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="confirmation-box"><span>{draftRequest?.kind === "payment" ? "Paying" : draftRequest?.kind === "repayment" ? "Repaying" : "Transferring to"}</span><strong>{paymentDraft?.beneficiaryLabel ?? draftRequest?.beneficiary ?? "Recipient"}</strong><span>From {sourceName}</span><strong className="confirm-amount">{kes(amount)}</strong><span>Reference: {draftRequest?.reference ?? "Payment"}</span></div>
            <button className="primary-button modal-submit" type="submit" disabled={submitting}>{submitting ? "Processing…" : "Confirm payment"} <Check size={16} /></button>
            <button className="back-link" type="button" onClick={onClose} disabled={submitting}>Cancel payment</button>
            <p className="modal-footnote"><ShieldCheck size={14} /> Payments can’t be reversed once completed.</p>
          </form>
        )}
      </section>
    </div>
  );
}

export default App;
