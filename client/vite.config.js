import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.[tj]sx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    https: false, // Use HTTP for development to avoid SSL issues
    proxy: {
      '/api': {
        target: 'https://localhost:5000',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['react-hot-toast', 'lucide-react', 'react-icons'],
        },
      },
    },
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    https: (() => {
      try {
        const certDir = path.join(__dirname, '../server/certs');
        const keyPath = path.join(certDir, 'key.pem');
        const certPath = path.join(certDir, 'cert.pem');
        
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
          return {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
          };
        }
      } catch (error) {
        console.log('Using HTTP for preview server');
      }
      return false;
    })(),
  },
  define: {
    global: 'globalThis',
    'process.env': {},
  },
})
