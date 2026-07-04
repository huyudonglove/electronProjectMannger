import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'renderer-src',
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../renderer-vue',
    emptyOutDir: true,
  },
})
