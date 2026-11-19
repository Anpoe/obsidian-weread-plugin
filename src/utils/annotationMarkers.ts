/** Remove WeRead's plain numeric note markers, preserving Markdown links and wikilinks. */
export const removeAnnotationMarkers = (text: string): string => {
	if (!text) return text;
	return text.replace(/\uFFFC/g, '').replace(/\uFEFF?[ \t]*\[\d+\](?![\]\[(])/g,
		(marker: string, offset: number, source: string) => {
			const previous = source[offset - 1];
			return previous === '[' || previous === '\\' ? marker : '';
		});
};
