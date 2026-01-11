import * as vscode from 'vscode';
import { PlantViewProvider } from './plantViewProvider';

let plantViewProvider: PlantViewProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Pomodoro Plants is now active! 🌱');

    // Create the plant view provider
    plantViewProvider = new PlantViewProvider(context.extensionUri, context);

    // Register the webview view provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'pomodoroPlants.gardenView',
            plantViewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('pomodoroPlants.startTimer', () => {
            plantViewProvider.startTimer();
        }),
        vscode.commands.registerCommand('pomodoroPlants.stopTimer', () => {
            plantViewProvider.stopTimer();
        }),
        vscode.commands.registerCommand('pomodoroPlants.resetTimer', () => {
            plantViewProvider.resetTimer();
        }),
        vscode.commands.registerCommand('pomodoroPlants.harvestFruit', () => {
            plantViewProvider.harvestFruit();
        }),
        vscode.commands.registerCommand('pomodoroPlants.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'pomodoroPlants');
        })
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('pomodoroPlants')) {
                plantViewProvider.reloadSettings();
            }
        })
    );

    // Track window focus for auto-pause/resume
    context.subscriptions.push(
        vscode.window.onDidChangeWindowState((state) => {
            plantViewProvider.handleWindowFocusChange(state.focused);
        })
    );
}

export function deactivate() {
    if (plantViewProvider) {
        plantViewProvider.saveState();
    }
}

