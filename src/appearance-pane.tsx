import type { Client } from '@justfiles/app'
import type { DockMaterial } from '@justfiles/app/capabilities/settings'
import { imageDataUrl } from '@justfiles/app/image-type'
import { type ChangeEvent, type CSSProperties, useEffect, useRef, useState } from 'react'
import { DOCK_MATERIALS, normalizeHex, type SettingsApp, WALLPAPER_COLORS } from './app.ts'
import './appearance-pane.css'

// Wallpaper and dock material share one stage because their contrast depends on each
// other. Both settings live on the Volume, so this pane keeps only its preview state.

// What the pane knows about the current wallpaper: a colour, a picture (as the data URL it
// shows), or neither — the shell's own default.
type Wallpaper = { color: string | null; image: string | null }

const NONE: Wallpaper = { color: null, image: null }

// The words under the tray. `Default` is a real answer, not an empty one: it is what
// Reset goes back to, and what a device that never set one is showing.
function caption(wallpaper: Wallpaper): string {
	if (wallpaper.image) return 'Your picture'
	if (!wallpaper.color) return 'Default'
	const preset = WALLPAPER_COLORS.find((c) => c.hex === wallpaper.color)
	return `${preset?.name ?? 'Custom'} · ${wallpaper.color.toUpperCase()}`
}

// Light enough that a white tick would vanish on it.
function isLight(hex: string): boolean {
	const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
	return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) > 150
}

export function AppearancePane({ client }: { client: Client<SettingsApp> }) {
	const [wallpaper, setWallpaper] = useState<Wallpaper>(NONE)
	const [material, setMaterial] = useState<DockMaterial>('smoked')
	const [previewMaterial, setPreviewMaterial] = useState<DockMaterial | null>(null)
	// A host whose shell has no wallpaper (the Mac app today) reports the methods
	// unavailable — say so, the way the Usage pane does with no meter.
	const [unavailable, setUnavailable] = useState(false)
	const [dockUnavailable, setDockUnavailable] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const loaded = useRef(false)

	useEffect(() => {
		if (loaded.current) return
		loaded.current = true
		client
			.readWallpaper({})
			.then(setWallpaper)
			.catch((e: unknown) => {
				const message = e instanceof Error ? e.message : String(e)
				if (message.includes('CAPABILITY_UNAVAILABLE')) setUnavailable(true)
				else setError(message)
			})
		client
			.readDockMaterial({})
			.then(setMaterial)
			.catch((e: unknown) => {
				const message = e instanceof Error ? e.message : String(e)
				if (message.includes('CAPABILITY_UNAVAILABLE')) setDockUnavailable(true)
				else setError(message)
			})
	}, [client])

	// Optimistic: the preview IS the answer, and the file will hold the same bytes this pane
	// already has — a re-read would only tell it what it just said.
	//
	// SELECTING IS WHAT ORDERS A WRITE, not finishing whatever the selection needs first.
	// Procedures don't share the kernel's per-app queue, so the writes go through one chain
	// — and a selection claims its place in that chain THE MOMENT YOU CLICK, before a
	// picture's bytes are read. Otherwise a picture picked first but read slowly would be
	// written last and take back a later colour or material choice.
	//
	// `next` may therefore be a promise (the picture's own preview, which needs those
	// bytes). It applies only if nothing has been chosen since — `seq` is what a claim holds
	// — so a slow picture can never repaint the pane after you moved on.
	const queue = useRef<Promise<unknown>>(Promise.resolve())
	const seq = useRef(0)
	const enqueue = (write: () => Promise<unknown>) => {
		const done = queue.current.then(write, write)
		queue.current = done.catch(() => {})
		done.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
	}
	const run = (next: Wallpaper | Promise<Wallpaper>, write: () => Promise<unknown>) => {
		setError(null)
		const claim = ++seq.current
		void Promise.resolve(next).then(
			(wallpaper) => {
				if (claim === seq.current) setWallpaper(wallpaper)
			},
			// A failed preparation is reported by the write below, which shares it.
			() => {}
		)
		enqueue(write)
	}

	const setColor = (hex: string) =>
		run({ color: hex, image: null }, () => client.setWallpaperColor({ color: hex }))
	const pickMaterial = (next: DockMaterial) => {
		setError(null)
		setMaterial(next)
		setPreviewMaterial(null)
		enqueue(() => client.setDockMaterial({ material: next }))
	}

	// Not `async`: this claims its place in the chain synchronously (see `run`) and hands
	// both the preview and the write ONE read of the file.
	const setImage = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		// Let the same file be picked twice in a row (the input keeps its value otherwise).
		event.target.value = ''
		if (!file) return
		const read = file.arrayBuffer().then((buffer) => {
			const bytes = new Uint8Array(buffer)
			const image = imageDataUrl(bytes)
			// Rejecting is how this reaches the user: the write shares this promise, so the
			// message surfaces there and nothing is written.
			if (!image) throw new Error(`${file.name} isn’t an image this device can read.`)
			return { bytes, image }
		})
		run(
			read.then(({ image }) => ({ color: null, image })),
			async () => client.setWallpaperImage({ bytes: (await read).bytes })
		)
	}

	if (unavailable) {
		return (
			<div className="settings-pane">
				<Header />
				<section className="settings-card">
					<p className="settings-muted">This device’s desktop has no wallpaper to change.</p>
				</section>
			</div>
		)
	}

	return (
		<div className="settings-pane">
			<Header />
			<Preview wallpaper={wallpaper} material={previewMaterial ?? material} />
			<p className="wp-hint">Click the dock to see it open.</p>
			<section className="settings-card">
				<h2 className="settings-card-title">Wallpaper</h2>
				<div className="wp">
					<div className="wp-tray">
						<div className="wp-chips">
							{WALLPAPER_COLORS.map((preset) => (
								<button
									key={preset.hex}
									type="button"
									className="wp-tile"
									style={{ background: preset.hex }}
									data-light={isLight(preset.hex) || undefined}
									aria-pressed={wallpaper.color === preset.hex}
									aria-label={preset.name}
									title={`${preset.name} · ${preset.hex.toUpperCase()}`}
									onClick={() => setColor(preset.hex)}
								>
									<span className="wp-check" aria-hidden>
										✓
									</span>
								</button>
							))}
						</div>
						<span className="wp-sep" />
						<CustomColor
							wallpaper={wallpaper}
							onPick={setColor}
							onDrag={(hex) => setWallpaper({ color: hex, image: null })}
						/>
						<label
							className="wp-tile wp-pick"
							data-has={Boolean(wallpaper.image) || undefined}
							data-on={Boolean(wallpaper.image) || undefined}
							style={wallpaper.image ? { backgroundImage: `url(${wallpaper.image})` } : undefined}
							title="Use your own picture"
						>
							{wallpaper.image ? '' : '＋'}
							<input type="file" accept="image/*" onChange={setImage} />
						</label>
					</div>
					<div className="wp-foot">
						<span className="wp-caption">{caption(wallpaper)}</span>
						<button
							type="button"
							data-size="sm"
							disabled={!wallpaper.color && !wallpaper.image}
							onClick={() => run(NONE, () => client.clearWallpaper({}))}
						>
							Reset
						</button>
					</div>
				</div>
				{error ? <p className="settings-card-error">{error}</p> : null}
				<p className="settings-card-copy">
					Saved to your volume, so your desktop follows you to every device you sign in to.
				</p>
			</section>
			{dockUnavailable ? null : (
				<section className="settings-card">
					<h2 className="settings-card-title">Dock</h2>
					<div className="mat-row">
						{DOCK_MATERIALS.map((item) => (
							<button
								key={item.name}
								type="button"
								className="mat-tile"
								aria-pressed={material === item.name}
								onPointerEnter={() => setPreviewMaterial(item.name)}
								onPointerLeave={() => setPreviewMaterial(null)}
								onFocus={() => setPreviewMaterial(item.name)}
								onBlur={() => setPreviewMaterial(null)}
								onClick={() => pickMaterial(item.name)}
							>
								<span
									className="mat-sample"
									data-material={item.name}
									style={wallpaperStyle(wallpaper)}
								>
									<span className="mat-bar ds-slot">
										<span className="mat-field" />
										<span className="mat-key">N</span>
									</span>
								</span>
								<span className="mat-label">{item.label}</span>
							</button>
						))}
					</div>
					<p className="mat-caption">
						{DOCK_MATERIALS.find((item) => item.name === (previewMaterial ?? material))?.caption}
					</p>
				</section>
			)}
		</div>
	)
}

function Header() {
	return (
		<header className="settings-pane-header">
			<h1 className="settings-pane-title">Appearance</h1>
			<p className="settings-pane-copy">How your desktop looks. Changes apply right away.</p>
		</header>
	)
}

// Any colour at all. The preview follows the drag; the FILE is written once, when you
// commit — and that has to be a native `change` listener, because React's `onChange` is
// really the `input` event: it fires on every step of a drag, so committing there would
// write (and sync) a wallpaper per pixel the user dragged through.
//
// A picker dismissed rather than committed leaves the preview on the colour last dragged
// through. It is a preview, and the next commit corrects it — worth far less than a
// listener that fought the browser to find out.
function CustomColor({
	wallpaper,
	onPick,
	onDrag
}: {
	wallpaper: Wallpaper
	onPick: (hex: string) => void
	onDrag: (hex: string) => void
}) {
	const custom = wallpaper.color && !WALLPAPER_COLORS.some((c) => c.hex === wallpaper.color)
	const input = useRef<HTMLInputElement>(null)
	// Subscribed once; the handler reads the current `onPick` rather than re-subscribing on
	// every render (the parent hands a fresh closure each time).
	const pick = useRef(onPick)
	pick.current = onPick
	useEffect(() => {
		const el = input.current
		if (!el) return
		const commit = () => {
			const hex = normalizeHex(el.value)
			if (hex) pick.current(hex)
		}
		el.addEventListener('change', commit)
		return () => el.removeEventListener('change', commit)
	}, [])
	return (
		<span className="wp-well" data-on={custom || undefined} title="Any colour">
			<input
				ref={input}
				type="color"
				aria-label="Custom wallpaper colour"
				value={wallpaper.color ?? '#46534a'}
				onChange={(e) => onDrag(e.currentTarget.value)}
			/>
		</span>
	)
}

function wallpaperStyle(wallpaper: Wallpaper) {
	return wallpaper.image
		? { backgroundImage: `url(${wallpaper.image})` }
		: wallpaper.color
			? { background: wallpaper.color }
			: undefined
}

function Preview({ wallpaper, material }: { wallpaper: Wallpaper; material: DockMaterial }) {
	const [open, setOpen] = useState(false)
	return (
		<div className="wp-mini" data-material={material} data-open={open}>
			<div className="wp-field" style={wallpaperStyle(wallpaper)} />
			<div className="wp-bar">
				<span className="wp-bar-group">
					<span className="wp-bar-title">Notes</span>
					<span className="wp-quiet">1.2.0</span>
				</span>
				<span className="wp-bar-group">
					<span className="wp-quiet">Synced</span>
					<span className="wp-dot" />
					<span className="wp-quiet">Wed 9:41</span>
					<span className="wp-avatar" />
				</span>
			</div>
			<div className="wp-windows">
				{[0, 1].map((i) => (
					<div key={i} className="wp-win" data-i={i}>
						<div className="wp-win-bar">
							<i />
							<i />
						</div>
						<div className="wp-win-body">
							<b />
							<b />
							<b />
							<b />
						</div>
					</div>
				))}
			</div>
			<button
				type="button"
				className="wp-dock"
				data-open={open}
				aria-label="Preview the dock open"
				onClick={() => setOpen((value) => !value)}
			>
				<div className="wp-dock-sheet ds-raised">
					<div className="wp-dock-sheet-label">On this computer</div>
					<div className="wp-dock-grid">
						{['#e0a13c', '#d9605c', '#4f8fd6', '#7a6bd8', '#3fa08a'].map((color) => (
							<span key={color} style={{ '--key': color } as CSSProperties} />
						))}
					</div>
				</div>
				<div className="wp-dock-bar ds-slot">
					<div className="wp-dock-field">Search apps, or talk to Kodama…</div>
					<div className="wp-dock-apps">
						{[
							['N', '#e0a13c'],
							['P', '#d9605c'],
							['F', '#4f8fd6']
						].map(([label, color]) => (
							<span key={label} className="wp-dock-key" style={{ '--key': color } as CSSProperties}>
								{label}
							</span>
						))}
						<span className="wp-dock-face" />
					</div>
				</div>
			</button>
		</div>
	)
}
