import * as vscode from 'vscode';

interface GardenState {
    fruitsCollected: number;
    lastResetDate: string;
    currentSessionSeconds: number;
    isTimerRunning: boolean;
    completedSessions: number;
    isOnBreak: boolean;
    breakSecondsRemaining: number;
    currentBreakScene: number;
    nextBreakScene: number;
}

const BREAK_SCENES = ['hayBale', 'lemonade', 'fishing', 'treeNap'] as const;

interface Settings {
    pomodoroDuration: number;
    shortBreakDuration: number;
    longBreakDuration: number;
    sessionsBeforeLongBreak: number;
    autoStartOnFocus: boolean;
    showNotifications: boolean;
}

function getSettings(): Settings {
    const config = vscode.workspace.getConfiguration('pomodoroPlants');
    return {
        pomodoroDuration: config.get('pomodoroDuration', 20),
        shortBreakDuration: config.get('shortBreakDuration', 5),
        longBreakDuration: config.get('longBreakDuration', 15),
        sessionsBeforeLongBreak: config.get('sessionsBeforeLongBreak', 4),
        autoStartOnFocus: config.get('autoStartOnFocus', false),
        showNotifications: config.get('showNotifications', true)
    };
}

const STAGES = [
    'dirt',           // 0-10%: bare soil
    'watered',        // 10-20%: wet soil, ready to grow
    'cracking',       // 20-30%: soil cracking, something's coming
    'seedling',       // 30-40%: tiny green peek
    'sprout',         // 40-50%: small sprout with cotyledons
    'baby',           // 50-60%: first true leaves
    'growing',        // 60-70%: stem getting taller
    'leafy',          // 70-80%: more leaves, bushier
    'budding',        // 80-90%: flower bud forming
    'fruiting'        // 90-100%: full plant with fruit!
] as const;

export class PlantViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pomodoroPlants.gardenView';

    private _view?: vscode.WebviewView;
    private _state: GardenState;
    private _timerInterval?: NodeJS.Timeout;
    private _isWindowFocused: boolean = true;
    private _context: vscode.ExtensionContext;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext
    ) {
        this._context = context;
        this._state = this._loadState();
        this._checkDailyReset();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'start':
                    this.startTimer();
                    break;
                case 'stop':
                    this.stopTimer();
                    break;
                case 'reset':
                    this.resetTimer();
                    break;
                case 'harvest':
                    this.harvestFruit();
                    break;
                case 'ready':
                    this._updateWebview();
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('pomodoroPlants.openSettings');
                    break;
                case 'skipBreak':
                    this.skipBreak();
                    break;
                case 'changeBreakScene':
                    this._state.nextBreakScene = message.scene;
                    this.saveState();
                    break;
            }
        });

        // Resume timer if it was running
        if (this._state.isTimerRunning && this._isWindowFocused) {
            this._startTimerInterval();
        }

        this._updateWebview();
    }

    private _loadState(): GardenState {
        const saved = this._context.globalState.get<GardenState>('gardenState');
        if (saved) {
            return { 
                ...saved, 
                completedSessions: saved.completedSessions || 0,
                isOnBreak: saved.isOnBreak || false,
                breakSecondsRemaining: saved.breakSecondsRemaining || 0,
                currentBreakScene: saved.currentBreakScene || 0,
                nextBreakScene: saved.nextBreakScene ?? Math.floor(Math.random() * BREAK_SCENES.length)
            };
        }
        return {
            fruitsCollected: 0,
            lastResetDate: this._getTodayString(),
            currentSessionSeconds: 0,
            isTimerRunning: false,
            completedSessions: 0,
            isOnBreak: false,
            breakSecondsRemaining: 0,
            currentBreakScene: 0,
            nextBreakScene: Math.floor(Math.random() * BREAK_SCENES.length)
        };
    }

    public reloadSettings() {
        // Settings changed, update the webview
        this._updateWebview();
    }

    private _getPomodoroDurationSeconds(): number {
        return getSettings().pomodoroDuration * 60;
    }

    public saveState() {
        this._context.globalState.update('gardenState', this._state);
    }

    private _getTodayString(): string {
        return new Date().toISOString().split('T')[0];
    }

    private _checkDailyReset() {
        const today = this._getTodayString();
        if (this._state.lastResetDate !== today) {
            this._state.fruitsCollected = 0;
            this._state.lastResetDate = today;
            this._state.currentSessionSeconds = 0;
            this._state.isTimerRunning = false;
            this.saveState();
        }
    }

    public startTimer() {
        if (this._state.isTimerRunning) return;
        
        this._state.isTimerRunning = true;
        // Pre-select the break scene so user can preview it
        this._state.nextBreakScene = Math.floor(Math.random() * BREAK_SCENES.length);
        if (this._isWindowFocused) {
            this._startTimerInterval();
        }
        this.saveState();
        this._updateWebview();
    }

    public stopTimer() {
        this._state.isTimerRunning = false;
        this._stopTimerInterval();
        this.saveState();
        this._updateWebview();
    }

    public resetTimer() {
        this._state.currentSessionSeconds = 0;
        this._state.isTimerRunning = false;
        this._stopTimerInterval();
        this.saveState();
        this._updateWebview();
    }

    public harvestFruit() {
        if (this._state.currentSessionSeconds >= this._getPomodoroDurationSeconds()) {
            this._state.fruitsCollected++;
            this._state.completedSessions++;
            this._state.currentSessionSeconds = 0;
            this._state.isTimerRunning = false;
            this._stopTimerInterval();
            
            // Start break time!
            const settings = getSettings();
            const isLongBreak = this._state.completedSessions % settings.sessionsBeforeLongBreak === 0;
            this._state.isOnBreak = true;
            this._state.breakSecondsRemaining = (isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration) * 60;
            this._state.currentBreakScene = this._state.nextBreakScene;
            
            this.saveState();
            this._updateWebview();
            this._startBreakTimer();
            
            if (settings.showNotifications) {
                const breakType = isLongBreak ? 'long' : 'short';
                vscode.window.showInformationMessage(`🍅 Fruit harvested! Enjoy your ${breakType} break, farmer! 👨‍🌾`);
            }
        }
    }

    public skipBreak() {
        this._state.isOnBreak = false;
        this._state.breakSecondsRemaining = 0;
        this._stopTimerInterval();
        this.saveState();
        this._updateWebview();
    }

    private _startBreakTimer() {
        if (this._timerInterval) return;
        
        this._timerInterval = setInterval(() => {
            if (this._state.breakSecondsRemaining > 0) {
                this._state.breakSecondsRemaining--;
                this.saveState();
                this._updateWebview();
            } else {
                // Break is over
                this._stopTimerInterval();
                this._state.isOnBreak = false;
                this.saveState();
                this._updateWebview();
                if (getSettings().showNotifications) {
                    vscode.window.showInformationMessage('⏰ Break over! Ready to grow another plant? 🌱');
                }
            }
        }, 1000);
    }

    public handleWindowFocusChange(focused: boolean) {
        this._isWindowFocused = focused;
        
        if (this._state.isTimerRunning) {
            if (focused) {
                this._startTimerInterval();
            } else {
                this._stopTimerInterval();
            }
        } else if (focused && getSettings().autoStartOnFocus && this._state.currentSessionSeconds < this._getPomodoroDurationSeconds()) {
            // Auto-start on focus if enabled and session not complete
            this.startTimer();
        }
        this._updateWebview();
    }

    private _startTimerInterval() {
        if (this._timerInterval) return;
        
        this._timerInterval = setInterval(() => {
            if (this._state.currentSessionSeconds < this._getPomodoroDurationSeconds()) {
                this._state.currentSessionSeconds++;
                this.saveState();
                this._updateWebview();
            } else {
                this._stopTimerInterval();
                this._state.isTimerRunning = false;
                this.saveState();
                this._updateWebview();
                if (getSettings().showNotifications) {
                    vscode.window.showInformationMessage('🌱 Your plant is ready! Click to harvest your fruit!');
                }
            }
        }, 1000);
    }

    private _stopTimerInterval() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = undefined;
        }
    }

    private _getCurrentStage(): typeof STAGES[number] {
        const progress = this._state.currentSessionSeconds / this._getPomodoroDurationSeconds();
        if (progress < 0.1) return 'dirt';
        if (progress < 0.2) return 'watered';
        if (progress < 0.3) return 'cracking';
        if (progress < 0.4) return 'seedling';
        if (progress < 0.5) return 'sprout';
        if (progress < 0.6) return 'baby';
        if (progress < 0.7) return 'growing';
        if (progress < 0.8) return 'leafy';
        if (progress < 0.9) return 'budding';
        return 'fruiting';
    }

    private _updateWebview() {
        if (!this._view) return;

        const stage = this._getCurrentStage();
        const duration = this._getPomodoroDurationSeconds();
        const settings = getSettings();
        
        // Handle break time display
        if (this._state.isOnBreak) {
            const breakMins = Math.floor(this._state.breakSecondsRemaining / 60);
            const breakSecs = this._state.breakSecondsRemaining % 60;
            const breakTimeString = `${breakMins.toString().padStart(2, '0')}:${breakSecs.toString().padStart(2, '0')}`;
            
            this._view.webview.postMessage({
                type: 'update',
                isOnBreak: true,
                breakScene: BREAK_SCENES[this._state.currentBreakScene],
                breakTimeRemaining: breakTimeString,
                fruitsCollected: this._state.fruitsCollected,
                completedSessions: this._state.completedSessions
            });
            return;
        }

        const progress = Math.min(this._state.currentSessionSeconds / duration, 1);
        const remainingSeconds = duration - this._state.currentSessionSeconds;
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        this._view.webview.postMessage({
            type: 'update',
            isOnBreak: false,
            stage,
            progress,
            timeRemaining: timeString,
            isRunning: this._state.isTimerRunning,
            isFocused: this._isWindowFocused,
            fruitsCollected: this._state.fruitsCollected,
            canHarvest: this._state.currentSessionSeconds >= duration,
            durationMinutes: settings.pomodoroDuration,
            nextBreakScene: BREAK_SCENES[this._state.nextBreakScene]
        });
    }

    private _getHtmlForWebview(_webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pomodoro Plants</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            /* Dynamic font size based on editor */
            --base-font: var(--vscode-editor-font-size, 14px);
            
            /* Use VS Code theme colors for seamless integration */
            --bg-dark: var(--vscode-sideBar-background, #1e1e1e);
            --bg-mid: var(--vscode-sideBarSectionHeader-background, #252526);
            --border: var(--vscode-sideBar-border, #3c3c3c);
            
            /* Nature palette - refined terracotta */
            --soil: #3d2817;
            --soil-light: #5c3d24;
            --pot: #9b6b4a;
            --pot-dark: #6d4a35;
            --pot-light: #b8846a;
            --pot-rim: #c4967a;
            --stem: #2d5a27;
            --leaf: #4a8c3f;
            --leaf-light: #6db35f;
            --flower: #e85d75;
            --flower-center: #f4d03f;
            --fruit: #e74c3c;
            --fruit-shine: #ff6b6b;
            
            /* Text - uses VS Code colors */
            --text: var(--vscode-foreground, #cccccc);
            --text-dim: var(--vscode-descriptionForeground, #8a8a8a);
            --accent: #8bc78b;
        }

        body {
            font-family: 'VT323', monospace;
            font-size: var(--base-font);
            background: var(--bg-dark);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: clamp(8px, 4vw, 12px);
            image-rendering: pixelated;
            position: relative;
            overflow: hidden;
        }

        /* Subtle animated gradient overlay */
        body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(ellipse at 30% 90%, rgba(74, 140, 63, 0.08) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 10%, rgba(139, 199, 139, 0.05) 0%, transparent 40%);
            pointer-events: none;
            animation: ambient-shift 10s ease-in-out infinite alternate;
        }

        @keyframes ambient-shift {
            0% { opacity: 0.5; transform: scale(1); }
            100% { opacity: 1; transform: scale(1.1); }
        }

        /* Floating particles */
        .particles {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            overflow: hidden;
        }

        .particle {
            position: absolute;
            background: rgba(139, 199, 139, 0.5);
            border-radius: 50%;
            animation: float-up 15s linear infinite;
        }

        .particle:nth-child(1) { left: 10%; width: 2px; height: 2px; animation-delay: 0s; animation-duration: 18s; }
        .particle:nth-child(2) { left: 30%; width: 3px; height: 3px; animation-delay: 3s; animation-duration: 14s; }
        .particle:nth-child(3) { left: 50%; width: 2px; height: 2px; animation-delay: 6s; animation-duration: 16s; }
        .particle:nth-child(4) { left: 70%; width: 4px; height: 4px; animation-delay: 2s; animation-duration: 20s; }
        .particle:nth-child(5) { left: 90%; width: 2px; height: 2px; animation-delay: 5s; animation-duration: 12s; }

        @keyframes float-up {
            0% {
                transform: translateY(400px) scale(0);
                opacity: 0;
            }
            10% {
                opacity: 0.6;
                transform: translateY(350px) scale(1);
            }
            90% {
                opacity: 0.2;
            }
            100% {
                transform: translateY(-20px) scale(0.3);
                opacity: 0;
            }
        }

        .garden-container {
            width: 100%;
            max-width: 200px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }

        .status-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            padding: clamp(4px, 2vw, 6px) clamp(6px, 3vw, 10px);
            background: var(--bg-mid);
            border: 1px solid var(--border);
            border-radius: 6px;
            font-size: 1em;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        .fruits-display {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .fruit-icon {
            font-size: calc(var(--base-font) * 1.3);
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
        }

        .fruit-count {
            font-weight: bold;
            color: var(--accent);
            min-width: 20px;
        }

        .focus-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--text-dim);
            transition: all 0.3s;
            border: 2px solid rgba(0,0,0,0.3);
        }

        .focus-indicator.active {
            background: var(--leaf);
            box-shadow: 0 0 8px var(--leaf), 0 0 16px rgba(74,140,63,0.4);
            animation: pulse-glow 2s infinite;
        }

        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 8px var(--leaf), 0 0 16px rgba(74,140,63,0.4); }
            50% { box-shadow: 0 0 12px var(--leaf), 0 0 24px rgba(74,140,63,0.6); }
        }

        .status-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .settings-btn {
            background: none;
            border: none;
            font-size: calc(var(--base-font) * 1.15);
            cursor: pointer;
            padding: 2px;
            opacity: 0.6;
            transition: all 0.2s;
            border-radius: 4px;
        }

        .settings-btn:hover {
            opacity: 1;
            transform: rotate(45deg);
        }

        .plant-stage {
            width: clamp(100px, 50vw, 140px);
            height: clamp(100px, 50vw, 140px);
            position: relative;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            background: radial-gradient(ellipse at center bottom, rgba(139, 199, 139, 0.08) 0%, transparent 70%);
            border-radius: 8px;
            margin: 4px 0;
        }

        .pixel-art {
            image-rendering: pixelated;
            image-rendering: crisp-edges;
        }

        /* Pixel Art Plant Canvas */
        .plant-canvas {
            width: 100%;
            height: 100%;
            transition: opacity 0.3s ease;
        }

        .plant-canvas.fading {
            animation: fade-in-scene 0.5s ease forwards;
        }

        @keyframes fade-in-scene {
            0% { opacity: 0.3; filter: blur(2px); }
            100% { opacity: 1; filter: blur(0); }
        }

        .timer-display {
            font-size: calc(var(--base-font) * 2);
            color: var(--accent);
            text-shadow: 0 0 20px rgba(139, 199, 139, 0.4);
            letter-spacing: 2px;
            padding: 0.4em 0.8em;
            background: rgba(0,0,0,0.25);
            border-radius: 6px;
            border: 1px solid var(--border);
        }

        .timer-display.paused {
            opacity: 0.4;
            text-shadow: none;
            color: var(--text-dim);
        }

        .progress-bar {
            width: 100%;
            height: 14px;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--border);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
            cursor: pointer;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--stem) 0%, var(--leaf) 50%, var(--leaf-light) 100%);
            transition: width 0.3s ease;
            box-shadow: inset 0 -2px 0 rgba(0,0,0,0.2), 0 0 8px rgba(74, 140, 63, 0.3);
            pointer-events: none;
        }

        .progress-segments {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
        }

        .progress-segment {
            flex: 1;
            height: 100%;
            border-right: 1px solid rgba(255,255,255,0.1);
            transition: background 0.15s;
        }

        .progress-segment:last-child {
            border-right: none;
        }

        .progress-segment:hover {
            background: rgba(255,255,255,0.15);
        }

        .progress-segment.break-segment {
            background: rgba(139, 199, 139, 0.1);
            border-left: 1px solid rgba(139, 199, 139, 0.3);
            cursor: pointer;
        }

        .progress-segment.break-segment:hover {
            background: rgba(139, 199, 139, 0.25);
        }

        .progress-segment.break-segment:active {
            background: rgba(139, 199, 139, 0.4);
            transform: scale(0.95);
        }

        .preview-label {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-mid);
            border: 1px solid var(--soil-light);
            padding: 0.15em 0.4em;
            font-size: calc(var(--base-font) * 0.85);
            color: var(--accent);
            border-radius: 3px;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s;
            margin-bottom: 4px;
        }

        .progress-bar:hover .preview-label {
            opacity: 1;
        }

        .preview-indicator {
            font-size: calc(var(--base-font) * 0.9);
            color: var(--text-dim);
            text-align: center;
            width: 100%;
            height: 0;
            margin: 0;
            opacity: 0;
            transition: opacity 0.15s, height 0.15s;
            overflow: hidden;
        }

        .preview-indicator.visible {
            opacity: 1;
            height: auto;
            margin-top: 4px;
        }

        .controls {
            display: flex;
            gap: 8px;
            width: 100%;
            margin-top: 2px;
        }

        .btn {
            flex: 1;
            padding: 0.5em 0.4em;
            font-family: 'VT323', monospace;
            font-size: calc(var(--base-font) * 1.15);
            border: 2px solid var(--pot);
            background: linear-gradient(180deg, var(--pot-light) 0%, var(--pot) 50%, var(--pot-dark) 100%);
            color: var(--text);
            cursor: pointer;
            border-radius: 6px;
            text-transform: uppercase;
            transition: all 0.15s;
            box-shadow: 0 3px 0 var(--pot-dark), 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 0 var(--pot-dark), 0 6px 12px rgba(0,0,0,0.4);
        }

        .btn:active {
            transform: translateY(2px);
            box-shadow: 0 1px 0 var(--pot-dark);
        }

        .btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .btn.start {
            background: linear-gradient(180deg, var(--leaf-light) 0%, var(--leaf) 50%, var(--stem) 100%);
            border-color: var(--stem);
            box-shadow: 0 3px 0 #1e3d1a, 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn.start:hover {
            box-shadow: 0 5px 0 #1e3d1a, 0 6px 12px rgba(0,0,0,0.4);
        }

        .btn.start.pulsing {
            animation: pulse-start 2s ease-in-out infinite;
        }

        @keyframes pulse-start {
            0%, 100% { 
                transform: scale(1);
                box-shadow: 0 3px 0 #1e3d1a, 0 4px 8px rgba(0,0,0,0.3);
            }
            50% { 
                transform: scale(1.03);
                box-shadow: 0 3px 0 #1e3d1a, 0 6px 16px rgba(74,140,63,0.5);
            }
        }

        .btn.harvest {
            background: linear-gradient(180deg, var(--fruit-shine) 0%, var(--fruit) 50%, #c0392b 100%);
            border-color: #a02318;
            box-shadow: 0 3px 0 #8b1a10, 0 4px 8px rgba(0,0,0,0.3);
            animation: harvest-pulse 1.5s infinite;
        }

        .btn.harvest:hover {
            box-shadow: 0 5px 0 #8b1a10, 0 6px 12px rgba(0,0,0,0.4);
        }

        @keyframes harvest-pulse {
            0%, 100% { 
                box-shadow: 0 3px 0 #8b1a10, 0 4px 8px rgba(0,0,0,0.3), 0 0 0 0 rgba(231, 76, 60, 0.5); 
            }
            50% { 
                box-shadow: 0 3px 0 #8b1a10, 0 4px 8px rgba(0,0,0,0.3), 0 0 0 10px rgba(231, 76, 60, 0); 
            }
        }

        .break-controls {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }

        .break-label {
            font-size: calc(var(--base-font) * 1.3);
            color: var(--accent);
            text-shadow: 0 0 10px rgba(139, 199, 139, 0.5);
        }

        .btn.skip-break {
            background: linear-gradient(180deg, #6a6a6a 0%, #4a4a4a 50%, #3a3a3a 100%);
            border-color: #3a3a3a;
            box-shadow: 0 3px 0 #2a2a2a, 0 4px 8px rgba(0,0,0,0.3);
            font-size: 1em;
            padding: 0.4em 0.8em;
        }

        .btn.skip-break:hover {
            box-shadow: 0 5px 0 #2a2a2a, 0 6px 12px rgba(0,0,0,0.4);
        }

        .break-timer {
            color: var(--accent);
            font-size: calc(var(--base-font) * 1.7);
        }

        .stage-label {
            font-size: calc(var(--base-font) * 0.9);
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 1px;
            padding: 0.15em 0.5em;
            background: rgba(0,0,0,0.15);
            border-radius: 4px;
        }

        .paused-notice {
            font-size: calc(var(--base-font) * 0.9);
            color: var(--flower);
            text-align: center;
            width: 100%;
            height: 0;
            padding: 0;
            margin: 0;
            opacity: 0;
            transition: opacity 0.3s, height 0.15s;
            overflow: hidden;
        }

        .paused-notice.visible {
            opacity: 1;
            height: auto;
            padding: 2px 0;
            margin: 2px 0;
        }
    </style>
</head>
<body>
    <div class="particles">
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
    </div>
    <div class="garden-container">
        <div class="status-bar">
            <div class="fruits-display">
                <span class="fruit-icon">🍅</span>
                <span class="fruit-count" id="fruitCount">0</span>
            </div>
            <div class="status-right">
                <div class="focus-indicator" id="focusIndicator" title="Editor Focus"></div>
                <button class="settings-btn" id="settingsBtn" title="Settings">⚙️</button>
            </div>
        </div>

        <div class="plant-stage">
            <canvas id="plantCanvas" class="plant-canvas pixel-art" width="140" height="140"></canvas>
        </div>

        <div class="stage-label" id="stageLabel">dirt</div>

        <div class="timer-display" id="timerDisplay">20:00</div>

        <div class="progress-bar" id="progressBar">
            <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            <div class="progress-segments" id="progressSegments"></div>
            <div class="preview-label" id="previewLabel">stage</div>
        </div>
        <div class="preview-indicator" id="previewIndicator">👆 hover to preview</div>

        <div class="paused-notice" id="pausedNotice">⏸ focus editor to grow</div>

        <div class="controls">
            <button class="btn start" id="startBtn">▶ Start</button>
            <button class="btn" id="stopBtn">⏸ Pause</button>
        </div>

        <button class="btn harvest" id="harvestBtn" style="display: none; width: 100%;">
            🍅 Harvest!
        </button>

        <div class="break-controls" id="breakControls" style="display: none; width: 100%;">
            <div class="break-label">☕ Break Time!</div>
            <button class="btn skip-break" id="skipBreakBtn">
                Skip Break →
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const plantCanvas = document.getElementById('plantCanvas');
        const ctx = plantCanvas.getContext('2d');
        const timerDisplay = document.getElementById('timerDisplay');
        const progressFill = document.getElementById('progressFill');
        const progressBar = document.getElementById('progressBar');
        const progressSegments = document.getElementById('progressSegments');
        const previewLabel = document.getElementById('previewLabel');
        const previewIndicator = document.getElementById('previewIndicator');
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const harvestBtn = document.getElementById('harvestBtn');
        const focusIndicator = document.getElementById('focusIndicator');
        const fruitCount = document.getElementById('fruitCount');
        const stageLabel = document.getElementById('stageLabel');
        const pausedNotice = document.getElementById('pausedNotice');

        // Stage names for preview (10 plant stages + 1 break scene)
        const stageNames = [
            'dirt', 'watered', 'cracking', 'seedling', 'sprout',
            'baby', 'growing', 'leafy', 'budding', 'fruiting'
        ];
        const stageEmojis = ['🪴', '💧', '🌰', '🌱', '🌿', '🪻', '🌳', '🍃', '🌸', '🍅'];
        
        // Break scene names and emojis
        const breakSceneNames = ['hayBale', 'lemonade', 'fishing', 'treeNap'];
        const breakSceneLabels = ['hay bale rest', 'lemonade time', 'fishing', 'tree nap'];
        const breakSceneEmojis = ['🌾', '🍋', '🎣', '😴'];
        
        let currentActualStage = 'dirt';
        let isPreviewingStage = false;
        let currentNextBreakScene = 'hayBale';

        // Create progress bar segments (10 for plants + 1 for break preview)
        stageNames.forEach((name, index) => {
            const segment = document.createElement('div');
            segment.className = 'progress-segment';
            segment.dataset.stage = name;
            segment.dataset.index = index;
            segment.dataset.isBreak = 'false';
            
            segment.addEventListener('mouseenter', () => {
                isPreviewingStage = true;
                drawPlant(name);
                stageLabel.textContent = name + ' (preview)';
                previewLabel.textContent = stageEmojis[index] + ' ' + name;
                previewIndicator.classList.remove('visible');
            });
            
            progressSegments.appendChild(segment);
        });

        // Add break scene segment at the end
        const breakSegment = document.createElement('div');
        breakSegment.className = 'progress-segment break-segment';
        breakSegment.dataset.isBreak = 'true';
        
        function updateBreakPreview() {
            drawFarmerBreak(currentNextBreakScene);
            const sceneIndex = breakSceneNames.indexOf(currentNextBreakScene);
            stageLabel.textContent = '☕ ' + breakSceneLabels[sceneIndex] + ' (next)';
            previewLabel.textContent = breakSceneEmojis[sceneIndex] + ' break reward!';
        }
        
        breakSegment.addEventListener('mouseenter', () => {
            isPreviewingStage = true;
            
            // Add fade-in animation
            plantCanvas.classList.add('fading');
            updateBreakPreview();
            previewIndicator.classList.remove('visible');
        });
        
        breakSegment.addEventListener('mouseleave', () => {
            plantCanvas.classList.remove('fading');
            stopAllBreakAnimations();
        });
        
        function stopAllBreakAnimations() {
            stopFishingAnimation();
            stopHayAnimation();
            stopLemonadeAnimation();
            stopNapAnimation();
        }
        
        // Easter egg: click to cycle through break activities!
        breakSegment.addEventListener('click', () => {
            // Stop any current animation
            stopFishingAnimation();
            
            // Cycle to next scene
            const currentIndex = breakSceneNames.indexOf(currentNextBreakScene);
            const nextIndex = (currentIndex + 1) % breakSceneNames.length;
            currentNextBreakScene = breakSceneNames[nextIndex];
            
            // Tell extension to save the new choice
            vscode.postMessage({ command: 'changeBreakScene', scene: nextIndex });
            
            // Add a little animation feedback
            plantCanvas.classList.remove('fading');
            void plantCanvas.offsetWidth; // Trigger reflow
            plantCanvas.classList.add('fading');
            
            // Update preview
            updateBreakPreview();
        });
        
        progressSegments.appendChild(breakSegment);

        progressBar.addEventListener('mouseleave', () => {
            isPreviewingStage = false;
            plantCanvas.classList.remove('fading');
            stopAllBreakAnimations();
            drawPlant(currentActualStage);
            stageLabel.textContent = currentActualStage;
            previewIndicator.classList.add('visible');
            setTimeout(() => {
                if (!isPreviewingStage) {
                    previewIndicator.classList.remove('visible');
                }
            }, 2000);
        });

        // Pixel art colors
        const colors = {
            soil: '#3d2817',
            soilLight: '#5c3d24',
            pot: '#8b4513',
            potDark: '#5d2e0a',
            potLight: '#a0522d',
            potRim: '#c4713b',
            stem: '#2d5a27',
            stemDark: '#1e3d1a',
            leaf: '#4a8c3f',
            leafLight: '#6db35f',
            leafDark: '#3a6d32',
            flower: '#e85d75',
            flowerLight: '#ff8fa3',
            flowerCenter: '#f4d03f',
            fruit: '#e74c3c',
            fruitShine: '#ff6b6b',
            fruitDark: '#c0392b'
        };

        const OFFSET_Y = 5; // Shift everything down
        const OFFSET_X = 2; // Shift everything right to center
        
        function drawPixel(x, y, color, size = 4) {
            ctx.fillStyle = color;
            ctx.fillRect((x + OFFSET_X) * size, (y + OFFSET_Y) * size, size, size);
        }

        function drawPlant(stage) {
            ctx.clearRect(0, 0, 140, 140);
            
            // Draw pot (always present)
            drawPot();
            
            switch(stage) {
                case 'dirt':
                    drawDirt();
                    break;
                case 'watered':
                    drawWateredDirt();
                    break;
                case 'cracking':
                    drawCrackingDirt();
                    break;
                case 'seedling':
                    drawSeedling();
                    break;
                case 'sprout':
                    drawSprout();
                    break;
                case 'baby':
                    drawBabyPlant();
                    break;
                case 'growing':
                    drawGrowingPlant();
                    break;
                case 'leafy':
                    drawLeafyPlant();
                    break;
                case 'budding':
                    drawBuddingPlant();
                    break;
                case 'fruiting':
                    drawFruitingPlant();
                    break;
            }
        }

        function drawPot() {
            // Pot body
            for (let y = 22; y <= 28; y++) {
                const offset = Math.floor((y - 22) * 0.3);
                for (let x = 10 + offset; x <= 20 - offset; x++) {
                    drawPixel(x, y, colors.pot);
                }
            }
            // Pot rim
            for (let x = 9; x <= 21; x++) {
                drawPixel(x, 21, colors.potRim);
            }
            // Pot shading
            for (let y = 22; y <= 28; y++) {
                const offset = Math.floor((y - 22) * 0.3);
                drawPixel(10 + offset, y, colors.potLight);
                drawPixel(20 - offset, y, colors.potDark);
            }
            // Pot bottom
            for (let x = 12; x <= 18; x++) {
                drawPixel(x, 29, colors.potDark);
            }
        }

        // Stage 1: Bare dirt
        function drawDirt() {
            for (let x = 11; x <= 19; x++) {
                drawPixel(x, 20, colors.soil);
                if (x >= 12 && x <= 18) {
                    drawPixel(x, 19, colors.soilLight);
                }
            }
        }

        // Stage 2: Watered/wet soil
        function drawWateredDirt() {
            for (let x = 11; x <= 19; x++) {
                drawPixel(x, 20, '#2a1a0f'); // darker wet soil
                if (x >= 12 && x <= 18) {
                    drawPixel(x, 19, colors.soil);
                }
            }
            // Water droplet sparkle
            drawPixel(14, 19, '#5a7a9a');
            drawPixel(16, 20, '#5a7a9a');
        }

        // Stage 3: Soil cracking
        function drawCrackingDirt() {
            for (let x = 11; x <= 19; x++) {
                drawPixel(x, 20, colors.soil);
                if (x >= 12 && x <= 18) {
                    drawPixel(x, 19, colors.soilLight);
                }
            }
            // Cracks in soil
            drawPixel(15, 19, '#4a3020');
            drawPixel(15, 18, '#4a3020');
            drawPixel(14, 19, '#4a3020');
        }

        // Stage 4: Tiny seedling peeking
        function drawSeedling() {
            drawDirt();
            // Just a tiny green dot peeking out
            drawPixel(15, 18, '#5a9a4a');
            drawPixel(15, 17, colors.leafLight);
        }

        // Stage 5: Small sprout with cotyledons
        function drawSprout() {
            drawDirt();
            drawPixel(15, 18, colors.stem);
            drawPixel(15, 17, colors.stem);
            drawPixel(15, 16, colors.stem);
            // Cotyledon leaves (seed leaves)
            drawPixel(14, 15, colors.leafLight);
            drawPixel(16, 15, colors.leafLight);
        }

        // Stage 6: Baby plant with first true leaves
        function drawBabyPlant() {
            drawDirt();
            // Stem
            for (let y = 18; y >= 14; y--) {
                drawPixel(15, y, colors.stem);
            }
            // Cotyledons (lower)
            drawPixel(13, 16, colors.leafDark);
            drawPixel(17, 16, colors.leafDark);
            // First true leaves (upper, bigger)
            drawPixel(14, 14, colors.leaf);
            drawPixel(13, 13, colors.leafLight);
            drawPixel(16, 14, colors.leaf);
            drawPixel(17, 13, colors.leafLight);
        }

        // Stage 7: Growing taller
        function drawGrowingPlant() {
            drawDirt();
            // Taller stem
            for (let y = 18; y >= 11; y--) {
                drawPixel(15, y, colors.stem);
            }
            // Lower leaves
            drawPixel(13, 16, colors.leafDark);
            drawPixel(17, 16, colors.leafDark);
            // Middle leaves
            drawPixel(13, 14, colors.leaf);
            drawPixel(14, 13, colors.leafLight);
            drawPixel(17, 14, colors.leaf);
            drawPixel(16, 13, colors.leafLight);
            // Top leaves
            drawPixel(14, 10, colors.leafLight);
            drawPixel(16, 10, colors.leafLight);
        }

        // Stage 8: Leafy and bushy
        function drawLeafyPlant() {
            drawDirt();
            // Main stem
            for (let y = 18; y >= 8; y--) {
                drawPixel(15, y, colors.stem);
            }
            // Branch stems
            drawPixel(14, 14, colors.stemDark);
            drawPixel(16, 12, colors.stemDark);
            
            // Lots of leaves!
            drawPixel(12, 16, colors.leafDark);
            drawPixel(13, 15, colors.leaf);
            drawPixel(18, 16, colors.leafDark);
            drawPixel(17, 15, colors.leaf);
            
            drawPixel(12, 13, colors.leaf);
            drawPixel(13, 12, colors.leafLight);
            drawPixel(18, 13, colors.leaf);
            drawPixel(17, 12, colors.leafLight);
            
            drawPixel(13, 9, colors.leafLight);
            drawPixel(14, 8, colors.leaf);
            drawPixel(17, 9, colors.leafLight);
            drawPixel(16, 8, colors.leaf);
            
            // Top tuft
            drawPixel(14, 6, colors.leafLight);
            drawPixel(15, 5, colors.leaf);
            drawPixel(16, 6, colors.leafLight);
        }

        // Stage 9: Flower bud forming
        function drawBuddingPlant() {
            drawDirt();
            // Main stem
            for (let y = 18; y >= 6; y--) {
                drawPixel(15, y, colors.stem);
            }
            // Branch
            drawPixel(14, 10, colors.stemDark);
            drawPixel(13, 9, colors.stem);
            
            // Leaves
            drawPixel(12, 16, colors.leafDark);
            drawPixel(13, 15, colors.leaf);
            drawPixel(18, 16, colors.leafDark);
            drawPixel(17, 15, colors.leaf);
            drawPixel(12, 12, colors.leaf);
            drawPixel(13, 11, colors.leafLight);
            drawPixel(18, 12, colors.leaf);
            drawPixel(17, 11, colors.leafLight);
            
            // Flower bud (closed)
            drawPixel(15, 4, colors.stem); // stem
            drawPixel(14, 4, colors.leafDark); // sepal
            drawPixel(16, 4, colors.leafDark); // sepal
            drawPixel(15, 3, '#c4a030'); // yellow bud tip
            drawPixel(14, 3, colors.flower); // pink showing
            drawPixel(16, 3, colors.flower);
            
            // Secondary bud on branch
            drawPixel(12, 8, colors.leafDark);
            drawPixel(12, 7, '#c4a030');
        }

        // Stage 10: Full fruiting plant!
        function drawFruitingPlant() {
            drawDirt();
            // Main stem
            for (let y = 18; y >= 5; y--) {
                drawPixel(15, y, colors.stem);
            }
            // Branches
            drawPixel(14, 11, colors.stemDark);
            drawPixel(13, 10, colors.stem);
            drawPixel(12, 9, colors.stem);
            drawPixel(16, 8, colors.stemDark);
            drawPixel(17, 7, colors.stem);
            
            // Leaves
            drawPixel(12, 16, colors.leafDark);
            drawPixel(13, 15, colors.leaf);
            drawPixel(18, 16, colors.leafDark);
            drawPixel(17, 15, colors.leaf);
            drawPixel(18, 12, colors.leaf);
            drawPixel(17, 11, colors.leafLight);
            drawPixel(19, 8, colors.leafLight);
            
            // Main fruit (big tomato!)
            drawPixel(14, 3, colors.fruit);
            drawPixel(15, 3, colors.fruit);
            drawPixel(16, 3, colors.fruitDark);
            drawPixel(13, 4, colors.fruitShine);
            drawPixel(14, 4, colors.fruit);
            drawPixel(15, 4, colors.fruit);
            drawPixel(16, 4, colors.fruitDark);
            drawPixel(14, 5, colors.fruit);
            drawPixel(15, 5, colors.fruitDark);
            drawPixel(15, 2, colors.stem); // stem
            drawPixel(14, 2, colors.leafLight); // leaf
            drawPixel(16, 2, colors.leafDark);
            
            // Second fruit on branch
            drawPixel(11, 8, colors.fruitShine);
            drawPixel(12, 8, colors.fruit);
            drawPixel(11, 9, colors.fruit);
            drawPixel(12, 9, colors.fruitDark);
            drawPixel(12, 7, colors.stem);
            
            // Third small fruit
            drawPixel(18, 6, colors.fruit);
            drawPixel(19, 6, colors.fruitDark);
            drawPixel(18, 5, colors.stem);
        }

        // ========== FARMER BREAK SCENES ==========
        const farmerColors = {
            skin: '#e8b89d',
            skinShadow: '#c99a7c',
            hat: '#c4713b',
            hatBand: '#8b4513',
            overalls: '#4a6fa5',
            overallsDark: '#3a5a8a',
            shirt: '#d44a4a',
            shirtDark: '#a83939',
            hay: '#d4a855',
            hayDark: '#b8923a',
            wood: '#8b6914',
            woodDark: '#6b5010',
            lemonade: '#f4e04d',
            glass: '#a8d8ea',
            water: '#5a9fd4',
            waterDark: '#4080b0',
            chicken: '#f5f5dc',
            chickenBeak: '#ff9933',
            chickenComb: '#cc3333'
        };

        function drawFarmerBreak(scene) {
            // Stop ALL animations before starting a new scene
            stopAllBreakAnimations();
            ctx.clearRect(0, 0, 140, 140);
            
            switch(scene) {
                case 'hayBale':
                    drawHayBaleScene();
                    break;
                case 'lemonade':
                    drawLemonadeScene();
                    break;
                case 'fishing':
                    drawFishingScene();
                    break;
                case 'treeNap':
                    drawTreeNapScene();
                    break;
            }
        }

        // Scene 1: Hay Bale Rest (animated!)
        let hayFrame = 0;
        let hayAnimInterval = null;
        
        function drawHayBaleScene() {
            if (!hayAnimInterval) {
                hayAnimInterval = setInterval(() => {
                    hayFrame = (hayFrame + 1) % 40;
                    if (isPreviewingStage) {
                        drawHayBaleSceneFrame();
                    }
                }, 150);
            }
            drawHayBaleSceneFrame();
        }
        
        function stopHayAnimation() {
            if (hayAnimInterval) {
                clearInterval(hayAnimInterval);
                hayAnimInterval = null;
            }
        }
        
        function drawHayBaleSceneFrame() {
            ctx.clearRect(0, 0, 140, 140);
            
            // Barn wall background - warm wood tones
            for (let y = 5; y <= 29; y++) {
                for (let x = 5; x <= 27; x++) {
                    // Horizontal wood planks
                    const plankColor = y % 3 === 0 ? '#5a3a2a' : '#7b5a4a';
                    drawPixel(x, y, plankColor);
                }
            }
            
            // Vertical wood beam on left
            for (let y = 5; y <= 29; y++) {
                drawPixel(5, y, '#4a2a1a');
                drawPixel(6, y, '#5a3a2a');
            }
            
            // Window showing blue sky outside
            // Sky background through window
            for (let y = 8; y <= 14; y++) {
                for (let x = 21; x <= 26; x++) {
                    // Sky gradient - lighter at top
                    const skyColor = y <= 10 ? '#7ab4d4' : '#5a9ac4';
                    drawPixel(x, y, skyColor);
                }
            }
            // Sun in window
            drawPixel(25, 9, '#f4e04d');
            drawPixel(26, 9, '#f4d03f');
            drawPixel(25, 10, '#f4d03f');
            
            // Window frame (dark wood, uniform)
            const frameColor = '#3a2a1a';
            // Top and bottom
            for (let x = 20; x <= 27; x++) {
                drawPixel(x, 7, frameColor);
                drawPixel(x, 15, frameColor);
            }
            // Left and right
            for (let y = 7; y <= 15; y++) {
                drawPixel(20, y, frameColor);
                drawPixel(27, y, frameColor);
            }
            // Window cross (centered)
            for (let y = 8; y <= 14; y++) {
                drawPixel(23, y, frameColor);
                drawPixel(24, y, frameColor);
            }
            for (let x = 21; x <= 26; x++) {
                drawPixel(x, 11, frameColor);
            }
            
            // Warm sunlight spilling onto floor
            const rayFlicker = hayFrame % 30 < 15 ? 1 : 0;
            drawPixel(19, 24, '#f4e08f');
            drawPixel(20, 25, '#f4e08f');
            drawPixel(18, 25 + rayFlicker, '#e4d07f');
            
            // Barn floor - darker wood
            for (let y = 27; y <= 29; y++) {
                for (let x = 5; x <= 27; x++) {
                    drawPixel(x, y, y === 27 ? '#4a3a2a' : '#3a2a1a');
                }
            }
            
            // Big golden hay bale with texture
            for (let y = 20; y <= 26; y++) {
                for (let x = 10; x <= 22; x++) {
                    const isTop = y === 20;
                    const isLeft = x === 10;
                    const isRight = x === 22;
                    let color = '#d4a84a'; // Golden hay
                    if (isTop) color = '#e4c86a'; // Lighter top
                    else if (isLeft) color = '#b4884a'; // Shadow left
                    else if (isRight) color = '#c49840';
                    drawPixel(x, y, color);
                }
            }
            // Hay texture strands
            drawPixel(12, 22, '#b4884a'); drawPixel(15, 21, '#c49840');
            drawPixel(18, 23, '#b4884a'); drawPixel(14, 24, '#c49840');
            drawPixel(20, 22, '#b4884a'); drawPixel(17, 25, '#c49840');
            drawPixel(11, 23, '#e4c86a'); drawPixel(19, 24, '#e4c86a');
            
            // Loose straw scattered on floor
            drawPixel(8, 26, '#d4a84a'); drawPixel(9, 27, '#c49840');
            drawPixel(24, 26, '#d4a84a'); drawPixel(25, 27, '#b4884a');
            drawPixel(7, 28, '#c49840'); drawPixel(23, 28, '#d4a84a');
            
            // Pitchfork leaning on wall
            drawPixel(7, 16, '#5a4a3a'); drawPixel(7, 17, '#5a4a3a');
            drawPixel(7, 18, '#5a4a3a'); drawPixel(7, 19, '#5a4a3a');
            drawPixel(7, 20, '#5a4a3a'); drawPixel(7, 21, '#5a4a3a');
            drawPixel(6, 15, '#8a8a8a'); drawPixel(7, 15, '#8a8a8a'); drawPixel(8, 15, '#8a8a8a');
            drawPixel(6, 14, '#aaaaaa'); drawPixel(8, 14, '#aaaaaa');
            
            // Farmer reclining on hay bale
            // Legs stretched
            drawPixel(14, 23, farmerColors.overalls);
            drawPixel(15, 23, farmerColors.overalls);
            drawPixel(16, 24, farmerColors.overalls);
            drawPixel(17, 24, farmerColors.overallsDark);
            // Boots
            drawPixel(17, 25, '#3a2a1a');
            drawPixel(18, 25, '#2a1a0a');
            // Body relaxed
            drawPixel(12, 21, farmerColors.overalls);
            drawPixel(13, 21, farmerColors.overallsDark);
            drawPixel(12, 20, farmerColors.shirt);
            drawPixel(13, 20, farmerColors.shirtDark);
            // Arms behind head
            drawPixel(11, 20, farmerColors.skin);
            drawPixel(14, 19, farmerColors.skin);
            // Head on pillow of hay
            drawPixel(11, 18, farmerColors.skin);
            drawPixel(12, 18, farmerColors.skinShadow);
            drawPixel(11, 19, farmerColors.skin);
            drawPixel(12, 19, farmerColors.skin);
            // Hat covering face (napping!)
            drawPixel(10, 17, farmerColors.hat);
            drawPixel(11, 17, farmerColors.hat);
            drawPixel(12, 17, farmerColors.hat);
            drawPixel(13, 17, farmerColors.hat);
            drawPixel(11, 16, farmerColors.hatBand);
            drawPixel(12, 16, farmerColors.hat);
            
            // Animated breathing (chest rises)
            const breathe = hayFrame % 30 < 15 ? 0 : 1;
            if (breathe) {
                drawPixel(12, 19, farmerColors.shirt);
            }
            
            // Animated straw in mouth (sticking out from under hat)
            const strawBob = hayFrame % 20 < 10 ? 0 : 1;
            drawPixel(13, 18, farmerColors.hay);
            drawPixel(14, 18 - strawBob, farmerColors.hay);
            drawPixel(15, 17 - strawBob, '#c49840');
            
            // Floating dust motes in sunlight
            const dustY1 = 16 + (hayFrame % 8);
            const dustY2 = 14 + ((hayFrame + 4) % 10);
            if (hayFrame % 3 === 0 && dustY1 < 25) {
                drawPixel(18, dustY1, '#f4e08f');
            }
            if (hayFrame % 4 === 1 && dustY2 < 24) {
                drawPixel(10, dustY2, '#c4b494');
            }
        }

        // Scene 2: Lemonade Stand (animated!)
        let lemonadeFrame = 0;
        let lemonadeAnimInterval = null;
        
        function drawLemonadeScene() {
            if (!lemonadeAnimInterval) {
                lemonadeAnimInterval = setInterval(() => {
                    lemonadeFrame = (lemonadeFrame + 1) % 60;
                    if (isPreviewingStage) {
                        drawLemonadeSceneFrame();
                    }
                }, 120);
            }
            drawLemonadeSceneFrame();
        }
        
        function stopLemonadeAnimation() {
            if (lemonadeAnimInterval) {
                clearInterval(lemonadeAnimInterval);
                lemonadeAnimInterval = null;
            }
        }
        
        function drawLemonadeSceneFrame() {
            ctx.clearRect(0, 0, 140, 140);
            
            // Full background - sky + grass
            for (let y = 5; y <= 29; y++) {
                for (let x = 5; x <= 27; x++) {
                    if (y <= 18) {
                        // Sky
                        drawPixel(x, y, '#7ab4d4');
                    } else {
                        // Grass
                        const grassColor = y < 24 ? colors.leafLight : y < 27 ? colors.leaf : colors.leafDark;
                        drawPixel(x, y, grassColor);
                    }
                }
            }
            
            // Sun
            drawPixel(6, 7, '#f4e04d');
            drawPixel(7, 7, '#f4e04d');
            drawPixel(6, 8, '#f4e04d');
            drawPixel(7, 8, '#f4d03f');
            
            // Lemonade stand (wooden booth)
            // Stand counter
            for (let x = 12; x <= 24; x++) {
                drawPixel(x, 21, farmerColors.wood);
                drawPixel(x, 22, farmerColors.woodDark);
            }
            // Stand legs
            for (let y = 23; y <= 27; y++) {
                drawPixel(12, y, farmerColors.woodDark);
                drawPixel(24, y, farmerColors.woodDark);
            }
            // Stand back wall
            for (let y = 14; y <= 20; y++) {
                for (let x = 13; x <= 23; x++) {
                    drawPixel(x, y, '#f4e890');
                }
            }
            // Stand roof
            for (let x = 11; x <= 25; x++) {
                drawPixel(x, 12, '#d44a4a');
                drawPixel(x, 13, '#b43a3a');
            }
            
            // "LEMONADE" sign (simplified as lemons decoration)
            drawPixel(15, 15, '#f4e04d');
            drawPixel(16, 15, '#f4e04d');
            drawPixel(18, 15, '#f4e04d');
            drawPixel(19, 15, '#f4e04d');
            drawPixel(21, 15, '#f4e04d');
            
            // Big pitcher of lemonade on counter
            drawPixel(17, 18, farmerColors.glass);
            drawPixel(18, 18, '#f4e04d');
            drawPixel(19, 18, farmerColors.glass);
            drawPixel(17, 19, farmerColors.glass);
            drawPixel(18, 19, '#f4e04d');
            drawPixel(19, 19, '#e4d03d');
            drawPixel(17, 20, farmerColors.glass);
            drawPixel(18, 20, '#e4d03d');
            drawPixel(19, 20, farmerColors.glass);
            drawPixel(20, 19, farmerColors.glass); // handle
            
            // Cups on counter
            drawPixel(14, 20, farmerColors.glass);
            drawPixel(15, 20, '#f4e04d');
            drawPixel(22, 20, farmerColors.glass);
            drawPixel(23, 20, '#f4e04d');
            
            // Lemons on counter
            drawPixel(14, 21, '#f4e04d');
            drawPixel(15, 21, '#e4c020');
            
            // Farmer standing next to stand, holding cup
            // Legs
            drawPixel(8, 27, farmerColors.overalls);
            drawPixel(9, 27, farmerColors.overalls);
            drawPixel(8, 26, farmerColors.overalls);
            drawPixel(9, 26, farmerColors.overallsDark);
            // Body
            drawPixel(8, 24, farmerColors.overalls);
            drawPixel(9, 24, farmerColors.overallsDark);
            drawPixel(8, 23, farmerColors.shirt);
            drawPixel(9, 23, farmerColors.shirtDark);
            // Head
            drawPixel(8, 21, farmerColors.skin);
            drawPixel(9, 21, farmerColors.skinShadow);
            drawPixel(8, 22, farmerColors.skin);
            drawPixel(9, 22, farmerColors.skin);
            // Hat
            drawPixel(7, 20, farmerColors.hat);
            drawPixel(8, 20, farmerColors.hat);
            drawPixel(9, 20, farmerColors.hat);
            drawPixel(10, 20, farmerColors.hat);
            drawPixel(8, 19, farmerColors.hat);
            drawPixel(9, 19, farmerColors.hatBand);
            
            // Arm holding cup (animated sipping)
            const sipPhase = lemonadeFrame % 40;
            const isSipping = sipPhase > 20 && sipPhase < 35;
            
            if (isSipping) {
                // Arm up, drinking
                drawPixel(10, 22, farmerColors.skin);
                drawPixel(10, 21, farmerColors.skin);
                // Cup at mouth
                drawPixel(10, 20, farmerColors.glass);
                drawPixel(11, 20, '#f4e04d');
            } else {
                // Arm relaxed, cup lowered
                drawPixel(10, 23, farmerColors.skin);
                drawPixel(10, 24, farmerColors.skin);
                // Cup in hand
                drawPixel(10, 25, farmerColors.glass);
                drawPixel(11, 25, '#f4e04d');
                drawPixel(11, 24, '#f4e04d');
            }
            
            // Refreshed sparkle when drinking
            if (isSipping && lemonadeFrame % 4 < 2) {
                drawPixel(6, 19, '#ffffff');
            }
        }

        // Scene 3: Fishing (animated!)
        let fishingFrame = 0;
        let fishingAnimInterval = null;
        
        function drawFishingScene() {
            // Start animation if not running
            if (!fishingAnimInterval) {
                fishingAnimInterval = setInterval(() => {
                    fishingFrame = (fishingFrame + 1) % 60;
                    if (isPreviewingStage) {
                        drawFishingSceneFrame();
                    }
                }, 100);
            }
            drawFishingSceneFrame();
        }
        
        function stopFishingAnimation() {
            if (fishingAnimInterval) {
                clearInterval(fishingAnimInterval);
                fishingAnimInterval = null;
            }
        }
        
        function drawFishingSceneFrame() {
            ctx.clearRect(0, 0, 140, 140);
            
            // Full background - sky + water
            for (let y = 5; y <= 29; y++) {
                for (let x = 5; x <= 27; x++) {
                    if (y <= 18) {
                        // Sky gradient
                        const skyColor = y < 12 ? '#5a7a9a' : '#4a6a8a';
                        drawPixel(x, y, skyColor);
                    } else if (y <= 20) {
                        // Shore/transition
                        drawPixel(x, y, '#3a4a5a');
                    } else {
                        // Water
                        let waterColor = farmerColors.waterDark;
                        if (y === 21) waterColor = '#4a7a9a';
                        else if (y <= 23) waterColor = farmerColors.water;
                        drawPixel(x, y, waterColor);
                    }
                }
            }
            
            // Distant trees/bushes
            drawPixel(6, 16, colors.leafDark);
            drawPixel(7, 15, colors.leaf);
            drawPixel(7, 16, colors.leafDark);
            drawPixel(8, 16, colors.leafDark);
            drawPixel(24, 15, colors.leaf);
            drawPixel(25, 15, colors.leafDark);
            drawPixel(25, 16, colors.leafDark);
            drawPixel(26, 16, colors.leaf);
            
            // Animated water sparkles
            const sparkleOffset = fishingFrame % 20;
            if (sparkleOffset < 10) {
                drawPixel(8 + (fishingFrame % 5), 23, '#7ec8e3');
                drawPixel(22 - (fishingFrame % 4), 25, '#9ed8f3');
            }
            if (sparkleOffset > 5 && sparkleOffset < 15) {
                drawPixel(12, 24, '#7ec8e3');
            }
            
            // Animated ripples around bobber
            const ripplePhase = fishingFrame % 30;
            if (ripplePhase < 10) {
                drawPixel(21, 24, '#7ec8e3');
                drawPixel(23, 24, '#7ec8e3');
            } else if (ripplePhase < 20) {
                drawPixel(20, 24, '#6ab8d3');
                drawPixel(24, 24, '#6ab8d3');
            }
            
            // Dock with wood grain
            for (let x = 10; x <= 19; x++) {
                drawPixel(x, 20, farmerColors.woodDark);
                drawPixel(x, 19, farmerColors.wood);
                if (x % 3 === 0) {
                    drawPixel(x, 19, farmerColors.woodDark);
                }
            }
            // Dock posts
            drawPixel(11, 21, farmerColors.woodDark);
            drawPixel(11, 22, farmerColors.woodDark);
            drawPixel(18, 21, farmerColors.woodDark);
            drawPixel(18, 22, farmerColors.woodDark);
            
            // Farmer sitting on dock
            // Legs dangling
            drawPixel(14, 20, farmerColors.overalls);
            drawPixel(15, 20, farmerColors.overallsDark);
            drawPixel(14, 21, farmerColors.overalls);
            drawPixel(15, 21, farmerColors.overalls);
            // Body
            drawPixel(14, 18, farmerColors.overalls);
            drawPixel(15, 18, farmerColors.overallsDark);
            drawPixel(14, 17, farmerColors.shirt);
            drawPixel(15, 17, farmerColors.shirtDark);
            // Arms
            drawPixel(13, 17, farmerColors.skin);
            drawPixel(16, 17, farmerColors.skin);
            // Head
            drawPixel(14, 15, farmerColors.skin);
            drawPixel(15, 15, farmerColors.skinShadow);
            drawPixel(14, 16, farmerColors.skin);
            drawPixel(15, 16, farmerColors.skin);
            // Hat
            drawPixel(13, 14, farmerColors.hat);
            drawPixel(14, 14, farmerColors.hat);
            drawPixel(15, 14, farmerColors.hat);
            drawPixel(16, 14, farmerColors.hat);
            drawPixel(14, 13, farmerColors.hatBand);
            drawPixel(15, 13, farmerColors.hat);
            
            // Fishing rod
            drawPixel(16, 16, farmerColors.wood);
            drawPixel(17, 15, farmerColors.wood);
            drawPixel(18, 14, farmerColors.wood);
            drawPixel(19, 13, farmerColors.wood);
            drawPixel(20, 12, farmerColors.woodDark);
            
            // Fishing line (slight sway animation)
            const sway = Math.sin(fishingFrame * 0.2) > 0 ? 1 : 0;
            drawPixel(21 + sway, 13, '#cccccc');
            drawPixel(21, 14, '#cccccc');
            drawPixel(21, 15, '#cccccc');
            drawPixel(21, 16, '#cccccc');
            drawPixel(21, 17, '#cccccc');
            drawPixel(21, 18, '#cccccc');
            drawPixel(21, 19, '#cccccc');
            drawPixel(21, 20, '#cccccc');
            drawPixel(21, 21, '#cccccc');
            
            // Bobber (animated bobbing)
            const bobY = 22 + (fishingFrame % 20 < 10 ? 0 : 1);
            drawPixel(21, bobY, '#ff4444');
            drawPixel(22, bobY, '#ff6666');
            drawPixel(21, bobY + 1, '#ffffff');
            
            // Occasional fish splash!
            if (fishingFrame > 45 && fishingFrame < 55) {
                drawPixel(9, 22, '#7ec8e3');
                drawPixel(8, 23, '#9ed8f3');
                drawPixel(10, 23, '#9ed8f3');
                // Little fish
                drawPixel(9, 23, '#f4a460');
                drawPixel(8, 24, '#f4a460');
            }
        }

        // Scene 4: Tree Nap (animated!)
        let napFrame = 0;
        let napAnimInterval = null;
        
        function drawTreeNapScene() {
            if (!napAnimInterval) {
                napAnimInterval = setInterval(() => {
                    napFrame = (napFrame + 1) % 80;
                    if (isPreviewingStage) {
                        drawTreeNapSceneFrame();
                    }
                }, 100);
            }
            drawTreeNapSceneFrame();
        }
        
        function stopNapAnimation() {
            if (napAnimInterval) {
                clearInterval(napAnimInterval);
                napAnimInterval = null;
            }
        }
        
        function drawTreeNapSceneFrame() {
            ctx.clearRect(0, 0, 140, 140);
            
            // Sky - full background
            for (let y = 5; y <= 29; y++) {
                for (let x = 5; x <= 27; x++) {
                    if (y <= 18) {
                        // Sky
                        const skyColor = y < 12 ? '#6a9aba' : '#5a8aaa';
                        drawPixel(x, y, skyColor);
                    } else {
                        // Grass ground
                        const grassColor = y < 24 ? colors.leafLight : y < 27 ? colors.leaf : colors.leafDark;
                        drawPixel(x, y, grassColor);
                    }
                }
            }
            
            // Fluffy cloud (rounded shape)
            drawPixel(8, 8, '#e8e8e8');
            drawPixel(9, 8, '#ffffff');
            drawPixel(10, 8, '#ffffff');
            drawPixel(11, 8, '#e8e8e8');
            drawPixel(9, 7, '#ffffff');
            drawPixel(10, 7, '#f0f0f0');
            drawPixel(7, 9, '#e0e0e0');
            drawPixel(8, 9, '#f0f0f0');
            drawPixel(9, 9, '#ffffff');
            drawPixel(10, 9, '#ffffff');
            drawPixel(11, 9, '#f0f0f0');
            drawPixel(12, 9, '#e0e0e0');
            drawPixel(7, 8, '#d8d8d8');
            drawPixel(12, 8, '#d8d8d8');
            
            // Grass tufts
            for (let x = 5; x <= 27; x++) {
                if (x % 4 === 0) {
                    drawPixel(x, 18, colors.leaf);
                }
            }
            
            // Big tree trunk
            for (let y = 16; y <= 29; y++) {
                drawPixel(21, y, farmerColors.wood);
                drawPixel(22, y, farmerColors.wood);
                drawPixel(23, y, farmerColors.woodDark);
            }
            // Trunk texture
            drawPixel(22, 20, farmerColors.woodDark);
            drawPixel(21, 24, farmerColors.woodDark);
            // Roots
            drawPixel(20, 28, farmerColors.woodDark);
            drawPixel(24, 28, farmerColors.wood);
            
            // Lush tree canopy
            for (let y = 8; y <= 18; y++) {
                for (let x = 15; x <= 28; x++) {
                    const distFromCenter = Math.abs(x - 22) + Math.abs(y - 13);
                    if (distFromCenter < 9) {
                        const leafColor = (x + y) % 3 === 0 ? colors.leafDark : 
                                         (x + y) % 3 === 1 ? colors.leaf : colors.leafLight;
                        drawPixel(x, y, leafColor);
                    }
                }
            }
            
            // Animated falling leaf
            const leafX = 18 + (napFrame % 20) / 4;
            const leafY = 10 + (napFrame % 40) / 2;
            if (napFrame < 40) {
                drawPixel(Math.floor(leafX), Math.floor(leafY), '#8ab050');
            }
            
            // Farmer lying down in shade
            // Blanket/ground sheet
            for (let x = 7; x <= 17; x++) {
                drawPixel(x, 27, '#8b7355');
            }
            // Body horizontal
            drawPixel(9, 26, farmerColors.overalls);
            drawPixel(10, 26, farmerColors.overalls);
            drawPixel(11, 26, farmerColors.overallsDark);
            drawPixel(12, 26, farmerColors.overalls);
            drawPixel(13, 26, farmerColors.overalls);
            // Chest
            drawPixel(9, 25, farmerColors.shirt);
            drawPixel(10, 25, farmerColors.shirtDark);
            // Arms
            drawPixel(11, 25, farmerColors.skin); // hand on chest
            drawPixel(8, 25, farmerColors.skin); // arm out
            // Legs
            drawPixel(14, 26, farmerColors.overalls);
            drawPixel(15, 27, farmerColors.overalls);
            drawPixel(16, 27, farmerColors.overallsDark);
            
            // Head with hat over face
            drawPixel(7, 25, farmerColors.skin);
            drawPixel(7, 24, farmerColors.skin);
            // Hat covering face
            drawPixel(6, 24, farmerColors.hat);
            drawPixel(7, 23, farmerColors.hat);
            drawPixel(8, 23, farmerColors.hat);
            drawPixel(6, 23, farmerColors.hatBand);
            
            // Animated breathing (chest moves)
            const breathe = napFrame % 30 < 15;
            if (breathe) {
                drawPixel(10, 24, farmerColors.shirt);
            }
            
            // Animated ZZZs floating up
            const zOffset = (napFrame % 20) / 5;
            const zOpacity = napFrame % 20;
            if (zOpacity < 15) {
                drawPixel(5, Math.floor(22 - zOffset), '#ffffff');
            }
            if (zOpacity > 5) {
                drawPixel(4, Math.floor(20 - zOffset), '#cccccc');
            }
            if (zOpacity > 10) {
                drawPixel(3, Math.floor(18 - zOffset), '#999999');
            }
            
            // Fireflies in evening light (occasional)
            if (napFrame > 60) {
                const fireflyPhase = (napFrame - 60) % 10;
                if (fireflyPhase < 5) {
                    drawPixel(25, 20, '#f4f4a0');
                    drawPixel(12, 15, '#f4f4a0');
                }
            }
        }

        // Event listeners
        startBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'start' });
        });

        stopBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'stop' });
        });

        harvestBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'harvest' });
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });

        document.getElementById('skipBreakBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'skipBreak' });
        });

        const breakControls = document.getElementById('breakControls');
        const controlsDiv = document.querySelector('.controls');

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'update') {
                // Update fruits (always)
                fruitCount.textContent = message.fruitsCollected;

                if (message.isOnBreak) {
                    // === BREAK MODE ===
                    drawFarmerBreak(message.breakScene);
                    stageLabel.textContent = '☕ break time';
                    timerDisplay.textContent = message.breakTimeRemaining;
                    timerDisplay.classList.remove('paused');
                    
                    // Hide work controls, show break controls
                    controlsDiv.style.display = 'none';
                    harvestBtn.style.display = 'none';
                    breakControls.style.display = 'flex';
                    progressFill.style.width = '100%';
                    pausedNotice.classList.remove('visible');
                } else {
                    // === WORK MODE ===
                    breakControls.style.display = 'none';
                    controlsDiv.style.display = 'flex';
                    
                    // Store actual stage and next break scene
                    currentActualStage = message.stage;
                    if (message.nextBreakScene) {
                        currentNextBreakScene = message.nextBreakScene;
                    }
                    
                    // Only update plant visual if not previewing
                    if (!isPreviewingStage) {
                        drawPlant(message.stage);
                        stageLabel.textContent = message.stage;
                    }
                    
                    // Update timer
                    timerDisplay.textContent = message.timeRemaining;
                    timerDisplay.classList.toggle('paused', !message.isRunning || !message.isFocused);
                    
                    // Update progress bar
                    progressFill.style.width = (message.progress * 100) + '%';
                    
                    // Update focus indicator
                    focusIndicator.classList.toggle('active', message.isFocused);
                    
                    // Update buttons
                    startBtn.disabled = message.isRunning;
                    stopBtn.disabled = !message.isRunning;
                    
                    // Pulse start button on dirt stage when not running
                    startBtn.classList.toggle('pulsing', message.stage === 'dirt' && !message.isRunning);
                    
                    // Show/hide harvest button
                    if (message.canHarvest) {
                        harvestBtn.style.display = 'block';
                        controlsDiv.style.display = 'none';
                    } else {
                        harvestBtn.style.display = 'none';
                        controlsDiv.style.display = 'flex';
                    }
                    
                    // Show paused notice
                    pausedNotice.classList.toggle('visible', message.isRunning && !message.isFocused);
                }
            }
        });

        // Initial draw
        drawPlant('dirt');
        
        // Signal ready
        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
    }
}

