import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
const require=createRequire(import.meta.url);
export function customModule(name, obsidian = {}) {
 const file = name.endsWith('/annotationMarkers') ? 'utils/annotationMarkers' : name === './readerContent' ? 'readerContent' : null;
 if (!file) return undefined;
 const module={exports:{}};
 const code=transformSync(readFileSync(new URL('../../src/'+file+'.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2017'}).code;
 new Function('require','module','exports',code)(n=>n==='obsidian'?obsidian:require(n),module,module.exports);
 return module.exports;
}
