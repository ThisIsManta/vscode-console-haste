import * as fp from 'path'
import * as vscode from 'vscode'
import * as ts from 'typescript'

export function parseTypeScript(document: vscode.TextDocument) {
	if (/^javascript(react)?$/.test(document.languageId)) {
		return ts.createSourceFile(fp.basename(document.fileName), document.getText(), ts.ScriptTarget.ESNext, true, document.languageId.endsWith('react') ? ts.ScriptKind.JSX : ts.ScriptKind.JS)
	}

	if (/^typescript(react)?$/.test(document.languageId)) {
		return ts.createSourceFile(fp.basename(document.fileName), document.getText(), ts.ScriptTarget.ESNext, true, document.languageId.endsWith('react') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
	}
}

export function isBlockLike(node: ts.Node): node is ts.BlockLike {
	return node !== undefined && ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseOrDefaultClause(node)
}
