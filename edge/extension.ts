import * as vscode from 'vscode'
import insertLog from './insertLog'
import deleteLog from './deleteLog'

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('consoleHaste.insertLog', async () => {
		const editor = vscode.window.activeTextEditor
		if (editor) {
			await insertLog(editor)
		}
	}))

	context.subscriptions.push(vscode.commands.registerCommand('consoleHaste.deleteLog', async () => {
		for (const editor of vscode.window.visibleTextEditors) {
			await deleteLog(editor)
		}
	}))
}
