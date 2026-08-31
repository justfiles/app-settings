import type { Client } from '@justfiles/app'
import type {
	AccountInfo,
	CapabilityId,
	ProviderInfo,
	UsageResource
} from '@justfiles/app/capabilities/settings'
import { defineReactGUI } from '@justfiles/app/react'
import { GameboyAvatar } from '@justfiles/avatar/react'
import { type ReactNode, StrictMode, useEffect, useRef, useState } from 'react'
import { AgentPane, useDrafting } from './agent-pane.tsx'
import {
	type Category,
	hasBothOrigins,
	initialState,
	originKind,
	type SettingsApp,
	type SettingsState
} from './app.ts'
import { AppearancePane } from './appearance-pane.tsx'
import { SystemPane } from './system-pane.tsx'
import './gui.css'

// How a provider projects an `ai`-capability account's config for the picker
// (see the host `describe`): the selected model + the list to choose from.
type AiConfig = { model: string; models: { id: string; name: string }[] }

// Merged onto `initialState` so the first frame has every field — the host pushes state
// before the mount effect's loads land, and a null `soul`/`usage` renders as "loading",
// not as a crash. NOT a migration: a state file written by another build is that build's
// shape and we do not translate it (AGENTS.md — no backward compatibility).
const stateOrInitial = (value: unknown): SettingsState =>
	value && typeof value === 'object'
		? { ...initialState, ...(value as Partial<SettingsState>) }
		: initialState

export const gui = defineReactGUI<SettingsApp>(({ state, client }) => (
	<StrictMode>
		<Settings state={stateOrInitial(state)} client={client} />
	</StrictMode>
))

const CATEGORIES: { id: Category; label: string; glyph: string }[] = [
	{ id: 'accounts', label: 'Accounts', glyph: '@' },
	{ id: 'appearance', label: 'Appearance', glyph: '◐' },
	{ id: 'system', label: 'System', glyph: 'ⓘ' }
]

const CAP_LABEL: Record<CapabilityId, string> = {
	email: 'Email',
	calendar: 'Calendar',
	ai: 'AI'
}

function Settings({ state, client }: { state: SettingsState; client: Client<SettingsApp> }) {
	// The drafting desk lives HERE, at the root that never unmounts, so a soul being written
	// survives switching panes — and nowhere else, so it never survives this window (see
	// `useDrafting`: reducer state replicates, a window's work in progress must not).
	const drafting = useDrafting(client, state.facts)
	const refreshed = useRef(false)
	useEffect(() => {
		if (refreshed.current) return
		refreshed.current = true
		void client.loadUser({})
		void client.loadProviders({})
		void client.loadAccounts({})
		void client.loadUsage({})
		void client.loadSoul({})
		void client.loadFacts({})
	}, [client])

	return (
		<div className="settings">
			<Sidebar state={state} client={client} />
			<section className="settings-detail">
				{/* One banner for both: a load that failed (reducer state) and a draft that did
				    not arrive (this window's desk, which is where a model call lives now). */}
				{state.error || drafting.error ? (
					<p className="settings-error">
						<span>{state.error ?? drafting.error}</span>
						<button
							type="button"
							onClick={() => {
								void client.clearError({})
								drafting.dismiss()
							}}
							data-size="sm"
						>
							Dismiss
						</button>
					</p>
				) : null}
				{state.category === 'agent' ? (
					<AgentPane state={state} client={client} drafting={drafting} />
				) : null}
				{state.category === 'accounts' ? <AccountsPanel state={state} client={client} /> : null}
				{state.category === 'account' ? <AccountPane state={state} client={client} /> : null}
				{/* The two panes that need no reducer state, for the same reason: a wallpaper is
				    bytes on the Volume and a version is a fact about THIS device (see
				    `readWallpaper` / `readVersion`), so each asks the host and holds its answer. */}
				{state.category === 'appearance' ? <AppearancePane client={client} /> : null}
				{state.category === 'system' ? <SystemPane client={client} /> : null}
			</section>
		</div>
	)
}

// The sidebar uses the same live canvas as the character sheet.
function AgentNavGlyph() {
	return (
		<span className="settings-nav-glyph settings-nav-face" aria-hidden>
			<GameboyAvatar />
		</span>
	)
}

function Sidebar({ state, client }: { state: SettingsState; client: Client<SettingsApp> }) {
	// The account row is itself a selectable row — the macOS Settings shape — and its pane
	// carries what is true about YOU: the facts your agent reads, your plan, your usage.
	const { category, user } = state
	const name = user?.name ?? (user ? 'User' : 'Local user')
	const status = user ? 'Signed in' : 'Not signed in'
	return (
		<aside className="settings-sidebar">
			<button
				type="button"
				className="settings-account"
				data-active={category === 'account' || undefined}
				aria-label={`Account — ${name}, ${status}`}
				onClick={() => void client.selectCategory({ category: 'account' })}
			>
				<div className="settings-avatar" aria-hidden>
					{user?.avatarUrl ? (
						<img src={user.avatarUrl} alt="" />
					) : (
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<title>User</title>
							<path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />
						</svg>
					)}
				</div>
				<div className="settings-account-text">
					<span className="settings-account-name">{name}</span>
					<span className="settings-account-sub">{status}</span>
				</div>
			</button>
			<nav className="settings-nav">
				<button
					type="button"
					className="settings-nav-item"
					data-active={category === 'agent' || undefined}
					onClick={() => void client.selectCategory({ category: 'agent' })}
				>
					<AgentNavGlyph />
					<span>{state.soul && !state.soul.seeded ? state.soul.name : 'Agent'}</span>
				</button>
				{CATEGORIES.map((c) => (
					<button
						key={c.id}
						type="button"
						className="settings-nav-item"
						data-active={category === c.id || undefined}
						onClick={() => void client.selectCategory({ category: c.id })}
					>
						<span className="settings-nav-glyph" aria-hidden>
							{c.glyph}
						</span>
						<span>{c.label}</span>
					</button>
				))}
			</nav>
		</aside>
	)
}

function AccountsPanel({ state, client }: { state: SettingsState; client: Client<SettingsApp> }) {
	const connectedIds = new Set(state.accounts.map((a) => a.providerId))
	const available = state.providers.filter((p) => !connectedIds.has(p.id))
	const twoLanes = hasBothOrigins(state.accounts)
	return (
		<div className="settings-pane">
			<header className="settings-pane-header">
				<h1 className="settings-pane-title">Accounts</h1>
				<p className="settings-pane-copy">Connect an account, then choose what it powers.</p>
				{twoLanes ? (
					<p className="settings-pane-copy">
						Some accounts sync across your devices; others are connected only on this one.
					</p>
				) : null}
			</header>
			{state.loading ? <p className="settings-muted">Loading…</p> : null}
			{!state.loading && state.providers.length === 0 ? (
				<section className="settings-card settings-card-empty">
					<p className="settings-muted">No account providers available here.</p>
				</section>
			) : null}
			{state.accounts.map((account) => (
				<ConnectedAccount
					key={account.accountId}
					account={account}
					provider={state.providers.find((p) => p.id === account.providerId)}
					client={client}
				/>
			))}
			{available.map((provider) => (
				<ProviderConnectForm key={provider.id} provider={provider} client={client} />
			))}
		</div>
	)
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`
	const units = ['KB', 'MB', 'GB', 'TB']
	let v = n / 1024
	let i = 0
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024
		i++
	}
	return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

function formatTokens(n: number): string {
	if (n < 1000) return String(n)
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
	return `${(n / 1_000_000).toFixed(1)}M`
}

// Human "resets in …" prefix from a window's reset instant (ms epoch). null = an idle burst
// window (nothing spent yet), so there's nothing to count down — render no prefix.
function resetsInText(resetsAt: number | null): string {
	if (resetsAt === null) return ''
	const ms = resetsAt - Date.now()
	if (ms <= 0) return ''
	const mins = Math.round(ms / 60000)
	if (mins < 60) return `Resets in ${mins}m · `
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) {
		const rem = mins % 60
		return `Resets in ${hrs}h${rem ? ` ${rem}m` : ''} · `
	}
	return `Resets in ${Math.round(hrs / 24)}d · `
}

// AI headline: percent of the cap used (no dollars, per Claude Code / Codex), or
// 'Unlimited' when uncapped. NOT clamped to 100% — a tier downgrade can leave prior spend
// above the new cap, and the true figure (e.g. 480%) is the point. The bar stays clamped.
function aiHeadLabel(r: UsageResource): string {
	return r.limit === null ? 'Unlimited' : `${Math.round(r.fraction * 100)}%`
}

// The Account pane: what is true about YOU. The facts your agent reads (name, birth date,
// gender — `/system/user.md`) sit above your plan and its meters, because they are facts
// about you and not about your companion, which is why they are not in the Agent pane.
function AccountPane({ state, client }: { state: SettingsState; client: Client<SettingsApp> }) {
	const usage = state.usage
	return (
		<div className="settings-pane">
			<header className="settings-pane-header">
				<h1 className="settings-pane-title">Account</h1>
				<p className="settings-pane-copy">You, your plan, and what your agent knows about you.</p>
			</header>
			<AboutYou state={state} client={client} />
			<h2 className="settings-card-title">Usage</h2>
			{!state.usageAvailable ? (
				<section className="settings-card">
					<p className="settings-muted">This device keeps no usage meter.</p>
				</section>
			) : !usage ? (
				<section className="settings-card">
					<p className="settings-muted">{state.usageError ? 'Couldn’t load usage.' : 'Loading…'}</p>
					<div className="settings-card-actions">
						<button type="button" data-size="sm" onClick={() => void client.loadUsage({})}>
							Retry
						</button>
					</div>
				</section>
			) : (
				<>
					<span className="settings-tier-badge">{usage.tier} plan</span>
					<Meter
						title="5h limit"
						resource={usage.aiBurst}
						value={aiHeadLabel(usage.aiBurst)}
						overHint="5h limit reached — it resets soon, or upgrade your plan."
						sub={`${resetsInText(usage.aiBurst.resetsAt)}Short-term burst limit`}
					/>
					<Meter
						title="Weekly limit"
						resource={usage.aiWeekly}
						value={aiHeadLabel(usage.aiWeekly)}
						overHint="Weekly limit reached — it resets soon, or upgrade your plan."
						sub={`${resetsInText(usage.aiWeekly.resetsAt)}${formatTokens(usage.aiTokens)} tokens · ${usage.aiRequests} requests`}
					/>
					<Meter
						title="Storage"
						resource={usage.storage}
						value={
							<>
								{formatBytes(usage.storage.used)}
								<span className="settings-meter-limit">
									{usage.storage.limit !== null
										? ` / ${formatBytes(usage.storage.limit)}`
										: ' · unlimited'}
								</span>
							</>
						}
						overHint="Over your storage limit — delete files or notes, or upgrade your plan."
						sub="Deduplicated content across your files and notes."
					/>
					<div className="settings-card-actions">
						<button type="button" data-size="sm" onClick={() => void client.loadUsage({})}>
							Refresh
						</button>
					</div>
				</>
			)}
		</div>
	)
}

// Only what you choose to inscribe: nothing here is inferred, and the birth date is
// stored as a date rather than an age so it stays true next year. The agent reads these
// to pitch how it speaks to you (a nine-year-old and a forty-year-old get different words).
function AboutYou({ state, client }: { state: SettingsState; client: Client<SettingsApp> }) {
	const facts = state.facts
	const [name, setName] = useState('')
	const [birthDate, setBirthDate] = useState('')
	const [saved, setSaved] = useState(false)
	// The volume is the truth; a sync replaces the fields under you unless you are typing.
	const editing = useRef(false)
	useEffect(() => {
		if (editing.current || !facts) return
		setName(facts.name)
		setBirthDate(facts.birthDate)
	}, [facts])

	// ONLY the field that changed is sent. Sending the whole profile made every save carry
	// a snapshot of the other two, so finishing a name edit and picking a gender in quick
	// succession let whichever landed last put the other one back.
	const save = async (patch: { name?: string; birthDate?: string; gender?: 'female' | 'male' }) => {
		await client.saveFacts(patch)
		setSaved(true)
		setTimeout(() => setSaved(false), 1200)
	}

	return (
		<section className="settings-card">
			<div className="settings-connected-row">
				<h2 className="settings-card-title">About you</h2>
				<span className="agent-saved" data-on={saved || undefined}>
					Saved
				</span>
			</div>
			<label className="settings-field" htmlFor="about-name">
				<span className="settings-field-title">Your name</span>
				<input
					id="about-name"
					className="settings-select"
					value={name}
					onFocus={() => {
						editing.current = true
					}}
					onChange={(e) => setName(e.target.value)}
					onBlur={() => {
						editing.current = false
						if (name !== facts?.name) void save({ name })
					}}
				/>
			</label>
			<label className="settings-field" htmlFor="about-birth">
				<span className="settings-field-title">Birth date — a date, never an age</span>
				<input
					id="about-birth"
					className="settings-select"
					type="date"
					value={birthDate}
					onChange={(e) => {
						setBirthDate(e.target.value)
						void save({ birthDate: e.target.value })
					}}
				/>
			</label>
			<div className="settings-field">
				<span className="settings-field-title">Gender</span>
				<div className="agent-seg">
					{(['female', 'male'] as const).map((option) => (
						<button
							key={option}
							type="button"
							className="agent-seg-button"
							data-on={facts?.gender === option}
							onClick={() => void save({ gender: option })}
						>
							{option === 'female' ? 'Female' : 'Male'}
						</button>
					))}
				</div>
			</div>
			<p className="settings-card-copy">
				Written to your volume as <span style={{ fontFamily: 'var(--font-mono)' }}>user.md</span>.
				Only what you put here — nothing is inferred.
			</p>
		</section>
	)
}

function Meter({
	title,
	resource,
	value,
	overHint,
	sub
}: {
	title: string
	resource: UsageResource
	value: ReactNode
	overHint: string
	sub: string
}) {
	const pct = Math.min(100, Math.round(resource.fraction * 100))
	return (
		<section className="settings-card">
			<div className="settings-meter-head">
				<h2 className="settings-card-title">{title}</h2>
				<span className="settings-meter-used">{value}</span>
			</div>
			{resource.limit !== null ? (
				<div className="settings-meter-bar">
					<div
						className="settings-meter-fill"
						data-exceeded={resource.exceeded || undefined}
						style={{ width: `${pct}%` }}
					/>
				</div>
			) : null}
			<p className="settings-meter-sub">
				{resource.exceeded ? `${overHint} ` : ''}
				{sub}
			</p>
		</section>
	)
}

// The badge text + tooltip Settings renders per lane (#296). `originKind` already
// degrades an absent `origin` (an older host) to 'cloud'.
function originLabel(account: AccountInfo): string {
	return originKind(account) === 'device' ? 'This device' : 'Synced'
}

function originHint(account: AccountInfo): string {
	if (originKind(account) !== 'device') return 'Synced across your devices'
	const label = account.origin?.kind === 'device' ? account.origin.label : undefined
	return label ? `Connected on ${label} only` : 'Connected on this device only'
}

function ConnectedAccount({
	account,
	provider,
	client
}: {
	account: AccountInfo
	provider?: ProviderInfo
	client: Client<SettingsApp>
}) {
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const caps = provider?.capabilities ?? account.enabled
	// `ai` may carry a model picker as its per-account config (host `describe`) — or
	// none, when the provider owns the model choice (e.g. platform AI). Guard on the
	// model list so a picker-less ai provider doesn't crash the card.
	const aiConfig =
		account.enabled.includes('ai') &&
		Array.isArray((account.config.ai as AiConfig | undefined)?.models)
			? (account.config.ai as AiConfig)
			: undefined

	const run = async (fn: () => Promise<void>) => {
		setBusy(true)
		setError(null)
		try {
			await fn()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	const disconnect = () => {
		// No `window.confirm` — the GUI runs in a sandboxed iframe that blocks modals, so
		// a confirm() is ignored and would make Disconnect a silent no-op. Disconnect is
		// reversible (just reconnect), so act directly.
		void run(() => client.disconnectAccount({ accountId: account.accountId }))
	}

	return (
		<section className="settings-card">
			<div className="settings-connected-row">
				<div className="settings-provider">
					<div className="settings-provider-mark">
						{(provider?.name ?? account.providerId ?? account.accountId ?? '?')
							.slice(0, 2)
							.toUpperCase()}
					</div>
					<div className="settings-provider-text">
						<h2 className="settings-card-title">
							{provider?.name ?? account.providerId ?? account.accountId}
						</h2>
						<p className="settings-account-status is-connected">
							{/* A builtin provider has exactly one account and its id is an internal
							    token — never show it; a connected account's id IS the identity
							    (an email), which is what distinguishes two accounts. */}
							{provider?.builtin ? 'Connected' : `Connected · ${account.accountId}`}
						</p>
					</div>
				</div>
				<span className="settings-origin-badge" title={originHint(account)}>
					{originLabel(account)}
				</span>
				{provider?.builtin ? null : (
					<button type="button" data-danger data-size="sm" disabled={busy} onClick={disconnect}>
						Disconnect
					</button>
				)}
			</div>
			<div className="settings-caps">
				{caps.map((cap) => {
					const on = account.enabled.includes(cap)
					// The built-in AI is the floor, not a peer: it needs no credentials, so it is what
					// runs whenever no other AI account is selected. It can be taken over (check another
					// provider's AI) but not switched off, so while it IS the active AI its toggle is
					// uncheckable rather than a click the host would silently undo.
					const floor = cap === 'ai' && on && provider?.builtin === true
					return (
						<label
							key={cap}
							className="settings-cap-toggle"
							title={
								floor ? 'Always available — enable another provider’s AI to take over' : undefined
							}
						>
							<input
								type="checkbox"
								checked={on}
								disabled={busy || floor}
								onChange={() =>
									void run(() =>
										client.setAccountEnabled({
											accountId: account.accountId,
											capability: cap,
											enabled: !on
										})
									)
								}
							/>
							<span>{CAP_LABEL[cap]}</span>
						</label>
					)
				})}
			</div>
			{aiConfig ? (
				<label className="settings-field" htmlFor={`model-${account.accountId}`}>
					<span className="settings-field-title">Model</span>
					<select
						id={`model-${account.accountId}`}
						className="settings-select"
						value={aiConfig.model}
						disabled={busy || aiConfig.models.length === 0}
						onChange={(e) =>
							void run(() =>
								client.setAccountEnabled({
									accountId: account.accountId,
									capability: 'ai',
									enabled: true,
									config: { model: e.target.value }
								})
							)
						}
					>
						{aiConfig.models.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				</label>
			) : null}
			{account.lastError ? <p className="settings-card-error">{account.lastError}</p> : null}
			{error ? <p className="settings-card-error">{error}</p> : null}
		</section>
	)
}

function ProviderConnectForm({
	provider,
	client
}: {
	provider: ProviderInfo
	client: Client<SettingsApp>
}) {
	const fields = provider.credentialsSchema
		? Object.entries(provider.credentialsSchema.properties)
		: []
	const [values, setValues] = useState<Record<string, string>>({})
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const connect = async () => {
		setBusy(true)
		setError(null)
		try {
			await client.connectAccount(
				provider.authKind === 'form'
					? { providerId: provider.id, credentials: values }
					: { providerId: provider.id }
			)
			setValues({})
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="settings-card">
			<div className="settings-provider">
				<div className="settings-provider-mark">{provider.name.slice(0, 2).toUpperCase()}</div>
				<div className="settings-provider-text">
					<h2 className="settings-card-title">{provider.name}</h2>
					<p className="settings-card-copy">
						Backs {provider.capabilities.map((c) => CAP_LABEL[c]).join(' · ')}.
					</p>
				</div>
			</div>
			{fields.map(([key, field]) => (
				<label key={key} className="settings-field" htmlFor={`connect-${provider.id}-${key}`}>
					<span className="settings-field-title">
						{key}
						{field.description ? ` — ${field.description}` : ''}
					</span>
					<input
						id={`connect-${provider.id}-${key}`}
						className="settings-select"
						type="password"
						autoComplete="off"
						value={values[key] ?? ''}
						disabled={busy}
						onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
					/>
				</label>
			))}
			{error ? <p className="settings-card-error">{error}</p> : null}
			<div className="settings-card-actions">
				<button type="button" data-primary disabled={busy} onClick={() => void connect()}>
					{busy ? 'Connecting…' : `Connect ${provider.name}`}
				</button>
			</div>
		</section>
	)
}
