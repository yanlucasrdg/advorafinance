const fs = require('fs');
const path = require('path');

const targetFiles = [
  'src/routes/_authenticated/comunicacoes.tsx',
  'src/routes/_authenticated/crm.tsx',
  'src/routes/_authenticated/dashboard.tsx',
  'src/routes/_authenticated/financeiro.tsx',
  'src/routes/_authenticated/integracoes.tsx',
  'src/routes/_authenticated/processos.tsx'
];

targetFiles.forEach(relPath => {
  const filePath = path.resolve(relPath);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove linhas de marcação do Git
    let lines = content.split(/\r?\n/).filter(line => 
      !line.startsWith('<<<<<<<') && 
      !line.startsWith('=======') && 
      !line.startsWith('>>>>>>>')
    );

    // Salva o arquivo limpo com codificação UTF-8 pura
    fs.writeFileSync(filePath, lines.join('\n'), { encoding: 'utf8' });
    console.log(`✅ Reparado: ${relPath}`);
  }
});

// Remove o arquivo de árvore para forçar regeneração limpa
const routeTree = path.resolve('src/routeTree.gen.ts');
if (fs.existsSync(routeTree)) {
  fs.unlinkSync(routeTree);
  console.log('🗑️ Cache de rotas removido.');
}