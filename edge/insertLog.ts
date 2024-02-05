import * as vscode from 'vscode'
import ts from 'typescript'
import { parseTypeScript, isBlockLike } from './typescript'
import sortBy from 'lodash/sortBy'

export default async function insertLog(editor: vscode.TextEditor) {
	const { document } = editor

	const rootNode = parseTypeScript(document)
	if (!rootNode) {
		return
	}

	const bottomFirstCursors = sortBy(editor.selections, cursor =>
		-Math.min(document.offsetAt(cursor.active), document.offsetAt(cursor.anchor))
	)

	let edited = false
	for (const cursor of bottomFirstCursors) {
		const selectionRange: [number, number] = cursor.isReversed
			? [document.offsetAt(cursor.active), document.offsetAt(cursor.anchor)]
			: [document.offsetAt(cursor.anchor), document.offsetAt(cursor.active)]

		const smallestMatchingNode = findMatchingNode(rootNode, selectionRange) ?? rootNode

		if (isBlockLike(smallestMatchingNode)) {
			const snippet = new vscode.SnippetString(createLog('$1'))
			snippet.appendTabstop(0)
			await editor.insertSnippet(snippet, cursor, { undoStopBefore: false, undoStopAfter: false })
			edited = true
			continue
		}

		const expressionNode = expandExpressionNode(smallestMatchingNode)
		if (!expressionNode) {
			continue
		}

		const [captionText, expressionText] = ((): [string, string | undefined] => {
			if (ts.isFunctionDeclaration(expressionNode) && expressionNode.name) {
				return [escape(expressionNode.name), undefined]
			}

			if (expressionNode.parent && ts.isPropertyAssignment(expressionNode.parent) && !ts.isComputedPropertyName(expressionNode.parent.name)) {
				return [truncate(escape(expressionNode.parent.name)), expressionNode.parent.initializer.getText()]
			}

			return [truncate(escape(expressionNode)), expressionNode.getText()]
		})()

		const edit = createEdit(expressionNode, createLog(captionText, expressionText), document)
		if (!edit) {
			continue
		}

		const [positionOrRange, text] = edit

		await editor.edit(editBuilder => {
			if (positionOrRange instanceof vscode.Range) {
				editBuilder.replace(positionOrRange, text)
			} else {
				editBuilder.insert(positionOrRange, text)
			}
		}, { undoStopBefore: false, undoStopAfter: false })

		edited = true
	}

	if (edited) {
		await vscode.commands.executeCommand('editor.action.formatDocument')
	}
}

function findMatchingNode(node: ts.Node, range: readonly [number, number]): ts.Node | undefined {
	return node.forEachChild(childNode => {
		if (childNode.getStart() <= range[0] && range[1] <= childNode.getEnd() && childNode.kind !== ts.SyntaxKind.EndOfFileToken) {
			const smallerNode = findMatchingNode(childNode, range)
			return smallerNode ?? childNode
		}
	})
}

function expandExpressionNode(node: ts.Node): ts.Node | null {
	if (!node || ts.isSourceFile(node)) {
		return null
	}

	if (isBlockLike(node)) {
		return node
	}

	if (ts.isIdentifier(node) && ts.isFunctionDeclaration(node.parent)) {
		return expandExpressionNode(node.parent)
	}

	if (ts.isFunctionDeclaration(node)) {
		return node
	}

	// Expand `0` to `array[0]`
	if (ts.isLiteralExpression(node) && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) {
		return node.parent
	}

	if (ts.isExpression(node)) {
		// Expand `field` to `object.field`
		if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
			return expandExpressionNode(node.parent)
		}

		// Expand `delegate` to `delegate(...args)`
		if (ts.isCallLikeExpression(node.parent) && 'expression' in node.parent && node.parent.expression === node) {
			return node.parent
		}

		return node
	}

	if (ts.isParameter(node)) {
		return node
	}

	if (ts.isVariableDeclaration(node)) {
		return node.name
	}

	if (ts.isVariableDeclarationList(node)) {
		return node.declarations[0].name
	}

	if (ts.isReturnStatement(node)) {
		return node.expression || null
	}

	if (ts.isStatement(node)) {
		if (!ts.isExpressionStatement(node)) {
			// Do not work with iteration or condition statements
			return null
		}

		return node
	}

	return expandExpressionNode(node.parent)
}

function createEdit(node: ts.Node, text: string, document: vscode.TextDocument): [vscode.Position | vscode.Range, string] | null {
	if (!node || !node.parent) {
		return null
	}

	if (ts.isFunctionDeclaration(node) && node.body) {
		return Δ({ inside: node.body })
	}

	if (ts.isArrowFunction(node.parent) && node.parent.body === node) {
		return Δ({ before: node.parent.body, prefix: 'return ' })
	}

	if (ts.isParameter(node) && (
		ts.isFunctionDeclaration(node.parent) ||
		ts.isFunctionExpression(node.parent) ||
		ts.isArrowFunction(node.parent) ||
		ts.isConstructorDeclaration(node.parent) ||
		ts.isMethodDeclaration(node.parent) ||
		ts.isAccessor(node.parent)
	) && node.parent.body) {
		if (ts.isExpression(node.parent.body)) {
			return Δ({ before: node.parent.body, prefix: 'return ' })

		} else {
			return Δ({ inside: node.parent.body })
		}
	}

	if (ts.isIfStatement(node.parent)) {
		if (node.parent.expression === node) {
			return Δ({ before: node.parent })
		}
	}

	if (ts.isWhileStatement(node.parent) || ts.isDoStatement(node.parent)) {
		if (ts.isBlock(node.parent.statement)) {
			return Δ({ inside: node.parent.statement })
		}

		return Δ({ before: node.parent.statement })
	}

	if (ts.isForInStatement(node.parent) || ts.isForOfStatement(node.parent)) {
		if (node.parent.initializer === node) {
			if (isBlockLike(node.parent.statement)) {
				return Δ({ inside: node.parent.statement })
			}

			return Δ({ before: node.parent.statement })
		}

		if (node.parent.expression === node) {
			return Δ({ before: node.parent })
		}
	}

	if (ts.isForStatement(node.parent)) {
		if (isBlockLike(node.parent.statement)) {
			return Δ({ inside: node.parent.statement })

		} else {
			return Δ({ before: node.parent.statement })
		}
	}

	if (ts.isReturnStatement(node)) {
		return Δ({ before: node })
	}

	if (ts.isStatement(node)) {
		return Δ({ after: node })
	}

	return createEdit(node.parent, text, document)

	function Δ(
		reference:
			| { before: ts.Statement | ts.Expression, prefix?: string }
			| { after: ts.Node }
			| { inside: ts.BlockLike },
	): NonNullable<ReturnType<typeof createEdit>> {
		if ('inside' in reference) {
			return Δ({ after: reference.inside.getFirstToken()! })

		} else if ('before' in reference) {
			if (isBlockLike(reference.before.parent)) {
				return [document.positionAt(reference.before.getStart()), text + '\n' + (reference.prefix || '')]
			}

			const range = new vscode.Range(
				document.positionAt(reference.before.getFullStart()),
				document.positionAt(reference.before.getEnd())
			)
			return [range, ' {\n' + text + '\n' + (reference.prefix || '') + reference.before.getText() + '\n}']

		} else {
			if (isBlockLike(reference.after.parent)) {
				return [document.positionAt(reference.after.getEnd()), '\n' + text]
			}

			const range = new vscode.Range(
				document.positionAt(reference.after.getFullStart()),
				document.positionAt(reference.after.getEnd())
			)
			return [range, ' {\n' + reference.after.getText() + '\n' + text + '\n}']
		}
	}
}

function format(text: string, cursor: vscode.Position | vscode.Range, editor: Pick<vscode.TextEditor, 'document' | 'options'>): string {
	const line = editor.document.lineAt(cursor instanceof vscode.Range ? cursor.start.line : cursor.line)

	const singleIndent = editor.options.insertSpaces === true && typeof editor.options.tabSize === 'number' ? ' '.repeat(editor.options.tabSize) : '\t'
	let indentLevel = line.firstNonWhitespaceCharacterIndex / singleIndent.length

	return text.split('\n').map((line, rank, lines) => {
		if (rank === 0) {
			return line
		}

		const prevLine = lines[rank - 1]
		if (prevLine.endsWith('{')) {
			indentLevel += 1
		}

		if (line.startsWith('}')) {
			indentLevel -= 1
		}

		if (indentLevel < 0) {
			indentLevel = 0
		}

		return singleIndent.repeat(indentLevel) + line
	}).join('\n')
}

function createLog(caption: string, expression?: string) {
	return `console.log(` +
		[`'*** ${caption}${expression ? ' »' : ''}'`, expression]
			.filter(item => typeof item === 'string')
			.join(', ') +
		`)`
}

function escape(input: string | ts.Node) {
	return (typeof input === 'string' ? input : input.getText())
		.replace(/\r?\n/g, '')
		.replace(/'/g, '"')
		.replace(/\s+/g, ' ')
}

function truncate(input: string) {
	if (input.length <= 30) {
		return input
	}

	if (input.endsWith(')')) {
		let lonelyOpenParenthesisCount = 0
		for (const char of input.substring(0, 28)) {
			if (char === '(')
				lonelyOpenParenthesisCount += 1
			if (char === ')')
				lonelyOpenParenthesisCount -= 1
		}

		if (lonelyOpenParenthesisCount > 0) {
			return input.substring(0, 28) + '⋯)'
		}
	}

	return input.substring(0, 29) + '⋯'
}
