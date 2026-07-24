const fs = require('fs');
const path = require('path');

function cleanConflicts(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '.output') {
        cleanConflicts(fullPath);
      }
    } else if (entry.isFile() && /\.(tsx?|jsx?|json|html|css)$/.test(entry.name)) {
      let content = fs.readFileSync(fullPath, 'utf8');

      if (content.includes('<<<<<<<') || content.includes('=======') || content.includes('>>>>>>>')) {
        const cleanedLines = content
          .split('\n')
          .filter(line => !line.includes('<<<<<<<') && !line.includes('=======') && !line.includes('>>>>>>>'));

        fs.writeFileSync(fullPath, cleanedLines.join('\n'), 'utf8');
        console.log(`✅ Arquivo limpo: ${fullPath}`);
      }
    }
  }
}

cleanConflicts('.');
console.log('✨ Varredura e limpeza concluídas!');