import { defineConfig } from 'vite';
import { tables } from './scripts/tables.js';
export default defineConfig({base:'./', plugins:[tables()]});
