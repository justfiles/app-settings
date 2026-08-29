import { kernelHost } from '@justfiles/app/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
	// Vite dev still uses installed packages. Keep its renderer and hooks on one React.
	resolve: { dedupe: ['react', 'react-dom'] },
	plugins: [
		react(),
		...(mode === 'test'
			? []
			: [
					kernelHost({
						id: 'justfiles.settings',
						name: 'Settings',
						description: 'Connect accounts and choose what they power',
						icon: 'icon.svg',
						imports: {
							react: 'https://esm.sh/react@19.2.8',
							'react/jsx-runtime': 'https://esm.sh/react@19.2.8/jsx-runtime',
							'react-dom/client': 'https://esm.sh/react-dom@19.2.8/client?deps=react@19.2.8'
						},
						app: 'src/app.ts',
						gui: 'src/gui.tsx'
					})
				])
	]
}))
