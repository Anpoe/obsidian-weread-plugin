import assert from 'node:assert/strict';
import test from 'node:test';
import {customModule} from './helpers/customModules.mjs';
const {removeAnnotationMarkers: clean}=customModule('../utils/annotationMarkers');
const {extractReaderParagraphs: extract, restoreParagraphBreaks: restore}=customModule('./readerContent');
test('annotation filter removes numeric and OBJ markers without changing paragraphs or links',()=>{
 assert.equal(clean('名字[3]和对象\uFFFC\n正文[18]'),'名字和对象\n正文');
 for(const s of ['[[1]]','[1](https://example.com)','[1][ref]','\\[1]','2026年 2²','[^1]','①'])assert.equal(clean(s),s);
});
test('recover a partial cross-paragraph highlight before filtering markers',()=>{
 const paragraphs=extract('<html><p>开头第一段[1]。</p><p>第二段\uFFFC。</p></html>');
 const restored=restore('第一段[1]。第二段\uFFFC。',paragraphs);
 assert.equal(restored,'第一段[1]。\n第二段\uFFFC。');
 assert.equal(clean(restored),'第一段。\n第二段。');
});
test('ambiguous or missing source is not guessed and existing newlines survive',()=>{
 assert.equal(restore('重复',extract('<html><p>重复</p><p>重复</p></html>')),undefined);
 assert.equal(restore('没有匹配',extract('<html><p>正文</p></html>')),undefined);
 assert.equal(restore('一\n二',extract('<html><p>一</p><p>二</p></html>')),undefined);
});
