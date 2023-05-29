import * as vscode from 'vscode'
import ts from 'typescript'
import { parseTypeScript } from './typescript'
import sortBy from 'lodash/sortBy'

export default async function deleteLog(editor: vscode.TextEditor) {
	const { document } = editor

	const rootNode = parseTypeScript(document)
	if (!rootNode) {
		return
	}

	const bottomFirstNodes = sortBy(findConsoleNodes(rootNode), node => -node.pos)

	await editor.edit(editBuilder => {
		for (const node of bottomFirstNodes) {
			if (!node.parent) {
				continue
			}

			if (ts.isExpressionStatement(node.parent) && (ts.isBlock(node.parent.parent) || ts.isSourceFile(node.parent.parent))) {
				const originalRange = new vscode.Range(
					document.positionAt(node.parent.getStart()),
					document.positionAt(node.parent.getEnd()),
				)
				const startLine = document.lineAt(originalRange.start.line)
				const endLine = document.lineAt(originalRange.end.line)
				if (startLine.firstNonWhitespaceCharacterIndex === originalRange.start.character && endLine.range.end.isEqual(originalRange.end)) {
					editBuilder.delete(
						new vscode.Range(
							startLine.range.start,
							endLine.rangeIncludingLineBreak.end,
						)
					)
				} else {
					editBuilder.delete(originalRange)
				}

			} else if (
				ts.isArrowFunction(node.parent) && node.parent.body === node ||
				ts.isExpressionStatement(node.parent) && ts.isCaseOrDefaultClause(node.parent.parent)
			) {
				editBuilder.replace(
					new vscode.Range(
						document.positionAt(node.getStart()),
						document.positionAt(node.getEnd()),
					),
					'{}'
				)

			} else {
				editBuilder.replace(
					new vscode.Range(
						document.positionAt(node.getStart()),
						document.positionAt(node.getEnd()),
					),
					'void 0'
				)
			}
		}
	}, { undoStopBefore: false, undoStopAfter: false })

	await vscode.commands.executeCommand('editor.action.formatDocument')
}

function findConsoleNodes(node: ts.Node): Array<ts.Expression> {
	if (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		ts.isIdentifier(node.expression.expression) &&
		node.expression.expression.text === 'console' &&
		ts.isIdentifier(node.expression.name) &&
		node.expression.name.text === 'log'
	) {
		return [node]
	}

	const output: Array<ts.Expression> = []
	node.forEachChild(childNode => {
		output.push(...findConsoleNodes(childNode))
	})
	return output
}
