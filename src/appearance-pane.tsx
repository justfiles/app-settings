import type { Client } from '@justfiles/app'
import { imageDataUrl } from '@justfiles/app/image-type'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { normalizeHex, type SettingsApp, WALLPAPER_COLORS } from './app.ts'
import './appearance-pane.css'

// The Appearance pane: the desktop's own look, previewed before you commit to it.
//
// TWO PARTS, AND THE ORDER IS THE POINT. On top, a SIMULATION of the shell — a menubar
// strip, two ghost windows, a simplified omnibar pill — because the question a wallpaper
// answers is not "is this a nice colour" but "can I still read my work on it". Under it,
// ONE ROW: the quiet presets, then the two ways of going off-menu (any colour, your own
// picture) as the last two tiles of the same row, because they are answers to the same
// question and not separate features. The words live in the caption, so no tile needs a
// label.
//
// NOTHING HERE IS REDUCER STATE. A wallpaper is bytes on the Volume (`app.ts`: a colour
// is a file too), so this pane reads the file once and thereafter knows what it wrote —
// see `readWallpaper`. That is also why the pane holds a `File`'s bytes only long enough
// to send them.

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
	// A host whose shell has no wallpaper (the Mac app today) reports the methods
	// unavailable — say so, the way the Usage pane does with no meter.
	const [unavailable, setUnavailable] = useState(false)
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
	}, [client])

	// Optimistic: the preview IS the answer, and the file will hold the same bytes this pane
	// already has — a re-read would only tell it what it just said.
	//
	// SELECTING IS WHAT ORDERS A WRITE, not finishing whatever the selection needs first.
	// Procedures don't share the kernel's per-app queue, so the writes go through one chain
	// — and a selection claims its place in that chain THE MOMENT YOU CLICK, before a
	// picture's bytes are read. Otherwise a picture picked first but read slowly would be
	// written last and take back the colour you chose while waiting for it.
	//
	// `next` may therefore be a promise (the picture's own preview, which needs those
	// bytes). It applies only if nothing has been chosen since — `seq` is what a claim holds
	// — so a slow picture can never repaint the pane after you moved on.
	const queue = useRef<Promise<unknown>>(Promise.resolve())
	const seq = useRef(0)
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
		const done = queue.current.then(write, write)
		// The chain must survive a failed link, so what the NEXT write waits on can't reject.
		queue.current = done.catch(() => {})
		done.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
	}

	const setColor = (hex: string) =>
		run({ color: hex, image: null }, () => client.setWallpaperColor({ color: hex }))

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
			<section className="settings-card">
				<h2 className="settings-card-title">Wallpaper</h2>
				<div className="wp">
					<Preview wallpaper={wallpaper} />
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
							className="settings-small-button"
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

// The simulation. Two ghost windows and a pill, because a wallpaper is judged with
// something sitting on top of it.
function Preview({ wallpaper }: { wallpaper: Wallpaper }) {
	const background = wallpaper.image
		? { backgroundImage: `url(${wallpaper.image})` }
		: wallpaper.color
			? { background: wallpaper.color }
			: undefined
	return (
		<div className="wp-mini">
			<div className="wp-field" style={background} />
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
			<div className="wp-omni">
				<span className="wp-omni-face" />
				<span className="wp-omni-ph">Ask, or open an app…</span>
				<span className="wp-omni-key">⌘K</span>
			</div>
		</div>
	)
}
