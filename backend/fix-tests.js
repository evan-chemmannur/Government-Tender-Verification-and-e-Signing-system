import fs from 'fs/promises';
import path from 'path';

async function main() {
  const testsDir = path.join(process.cwd(), 'tests');
  const files = await fs.readdir(testsDir);
  
  for (const file of files) {
    if (!file.endsWith('.test.js')) continue;
    
    const filePath = path.join(testsDir, file);
    let content = await fs.readFile(filePath, 'utf8');
    
    // Replace import { ...pool... } from './setup.js' with import { ...pool, setupTestDb, teardownTestDb... } from './setup.js'
    if (content.includes("from './setup.js'")) {
      content = content.replace(/import\s+{([^}]*)}\s+from\s+['"]\.\/setup\.js['"];/g, (match, imports) => {
        const parts = imports.split(',').map(s => s.trim());
        if (!parts.includes('setupTestDb')) parts.push('setupTestDb');
        if (!parts.includes('teardownTestDb')) parts.push('teardownTestDb');
        if (!parts.includes('pool')) parts.push('pool');
        return `import { ${parts.join(', ')} } from './setup.js';`;
      });
      
      // Inject setupTestDb into beforeAll
      if (content.includes('beforeAll(async () => {') && !content.includes('await setupTestDb()')) {
        content = content.replace('beforeAll(async () => {', 'beforeAll(async () => {\n    await setupTestDb();');
      } else if (content.includes('beforeAll(() => {') && !content.includes('await setupTestDb()')) {
        content = content.replace('beforeAll(() => {', 'beforeAll(async () => {\n    await setupTestDb();');
      } else if (!content.includes('beforeAll')) {
        // If no beforeAll, inject it after the last import
        const lines = content.split('\n');
        let lastImportIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('import ')) lastImportIndex = i;
        }
        if (lastImportIndex !== -1) {
          lines.splice(lastImportIndex + 1, 0, '\nbeforeAll(async () => {\n  await setupTestDb();\n});\n');
          content = lines.join('\n');
        }
      }

      // Inject teardownTestDb into afterAll
      if (content.includes('afterAll(async () => {') && !content.includes('await teardownTestDb()')) {
        content = content.replace('afterAll(async () => {', 'afterAll(async () => {\n    await teardownTestDb();');
      } else if (content.includes('afterAll(() => {') && !content.includes('await teardownTestDb()')) {
        content = content.replace('afterAll(() => {', 'afterAll(async () => {\n    await teardownTestDb();');
      } else if (!content.includes('afterAll') && content.includes('afterEach')) {
         // insert before afterEach
         content = content.replace(/afterEach\(/, 'afterAll(async () => {\n  await teardownTestDb();\n});\n\nafterEach(');
      } else if (!content.includes('afterAll') && content.includes('beforeAll')) {
          // insert after beforeAll block
          content = content.replace(/(beforeAll\(.*?\}\);)/s, '$1\n\nafterAll(async () => {\n  await teardownTestDb();\n});');
      }
      
      await fs.writeFile(filePath, content, 'utf8');
      console.log(`Updated ${file}`);
    }
  }
}

main().catch(console.error);
