import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Cosmograph uses an internal path alias `@/cosmograph/style.module.css`
 * that is not shipped in the npm package. Provide an empty CSS module
 * so both esbuild (dep optimization) and Vite can resolve it.
 */
function cosmographCssShim(): Plugin {
  const virtualId = '@/cosmograph/style.module.css'
  return {
    name: 'cosmograph-css-shim',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualId) return '\0' + virtualId
    },
    load(id) {
      if (id === '\0' + virtualId) return 'export default {}'
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cosmographCssShim()],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'cosmograph-css-shim',
          setup(build) {
            build.onResolve({ filter: /^@\/cosmograph\/style\.module\.css$/ }, () => ({
              path: '@/cosmograph/style.module.css',
              namespace: 'cosmograph-css-shim',
            }))
            build.onLoad({ filter: /.*/, namespace: 'cosmograph-css-shim' }, () => ({
              contents: 'export default {}',
              loader: 'js',
            }))
          },
        },
      ],
    },
  },
  server: {
    port: 5173,
    host: true
  }
})
