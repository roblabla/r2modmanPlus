import Game from '../../model/game/Game';
import GameManager from '../../model/game/GameManager';
import { getGameConfigBySettingsIdentifier } from '../../model/schema/ThunderstoreSchema';
import FsProvider from '../../providers/generic/file/FsProvider';
import path from '../../providers/node/path/path';
import appWindow from '../../providers/node/app/app_window';
import childProcess from '../../providers/node/child_process/child_process';
import InteractionProvider from '../../providers/ror2/system/InteractionProvider';
import LoggerProvider, { LogSeverity } from '../../providers/ror2/logging/LoggerProvider';
import ManagerSettings from '../manager/ManagerSettings';

// Steam may update the game or build shaders before starting it. A modded start that only comes after
// the files are gone runs without mods, which is safe.
export const STARTUP_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

let watcher: Promise<void> | undefined;

export function removesLinkedFilesOnExit(game: Game): boolean {
    return getGameConfigBySettingsIdentifier(game.settingsIdentifier)?.removeLinkedFilesOnExit === true;
}

/**
 * Removes the files r2modman copied into the game folder once the game has exited: right away if it
 * is not running and doesn't start within startupTimeoutMs. Only for games whose schema sets removeLinkedFilesOnExit.
 */
export async function removeLinkedFilesOnGameExit(game: Game, startupTimeoutMs: number): Promise<void> {
    if (!removesLinkedFilesOnExit(game)) {
        return;
    }
    // A watcher already running removes the same files.
    if (watcher !== undefined) {
        return watcher;
    }
    const settings = await ManagerSettings.getSingleton(game);
    const gameDirectory = settings.getContext().gameSpecific.gameDirectory;
    const linkedFiles = [...(settings.getContext().gameSpecific.linkedFiles || [])];
    if (gameDirectory == null || linkedFiles.length === 0) {
        return;
    }
    watcher = (async () => {
        try {
            if (await waitFor(game, true, startupTimeoutMs)) {
                await waitFor(game, false, Infinity);
            }
            await removeLinkedFiles(game, gameDirectory, linkedFiles);
        } catch (e) {
            LoggerProvider.instance.Log(LogSeverity.ERROR, `Failed to remove the files linked into ${gameDirectory}: ${e}`);
        } finally {
            watcher = undefined;
        }
    })();
    return watcher;
}

async function waitFor(game: Game, running: boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        if (await isGameRunning(game) === running) {
            return true;
        }
        if (Date.now() + POLL_INTERVAL_MS > deadline) {
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

export async function isGameRunning(game: Game): Promise<boolean> {
    const exeNames = game.exeName.map(name => name.toLowerCase());
    try {
        if (appWindow.getPlatform() === 'win32') {
            const tasks = await childProcess.execFile('tasklist', ['/FO', 'CSV', '/NH']);
            return tasks.split(/\r?\n/)
                .some(line => exeNames.includes((line.split('","')[0] ?? '').replace(/^"/, '').toLowerCase()));
        }
        // Under Proton, the game's processes carry the exe's path in their arguments. Inside the
        // Flatpak sandbox, ps only sees the sandbox's own processes.
        const env = await InteractionProvider.instance.getEnvironmentVariables();
        const processes = env.FLATPAK_ID
            ? await childProcess.execFile('flatpak-spawn', ['--host', 'ps', '-A', '-o', 'args='])
            : await childProcess.execFile('ps', ['-A', '-o', 'args=']);
        return processes.split('\n')
            .some(line => line.toLowerCase().split(/[\\/\s"]/).some(part => exeNames.includes(part)));
    } catch (e) {
        // Taken as not running: removing the files early at worst makes a modded start a vanilla one.
        LoggerProvider.instance.Log(LogSeverity.ERROR, `Failed to list running processes: ${e}`);
        return false;
    }
}

async function removeLinkedFiles(game: Game, gameDirectory: string, linkedFiles: string[]) {
    const fs = FsProvider.instance;
    const remaining: string[] = [];
    for (const file of linkedFiles) {
        try {
            if (await fs.exists(file)) {
                await fs.unlink(file);
            }
            await removeEmptyParents(gameDirectory, path.dirname(file));
            LoggerProvider.instance.Log(LogSeverity.INFO, `Removed linked file: ${file}`);
        } catch (e) {
            LoggerProvider.instance.Log(LogSeverity.ERROR, `Failed to remove linked file ${file}: ${e}`);
            remaining.push(file);
        }
    }
    // The settings singleton follows the game selected in the UI; another game's must not be loaded
    // under it. Files left listed are retried when this game is selected again.
    if (GameManager.activeGame?.settingsIdentifier === game.settingsIdentifier) {
        const settings = await ManagerSettings.getSingleton(game);
        await settings.setLinkedFiles(remaining);
    }
}

async function removeEmptyParents(gameDirectory: string, dir: string) {
    const fs = FsProvider.instance;
    while (path.relative(gameDirectory, dir) !== '' && !path.relative(gameDirectory, dir).startsWith('..')) {
        if (!(await fs.exists(dir)) || (await fs.readdir(dir)).length > 0) {
            return;
        }
        await fs.rmdir(dir);
        dir = path.dirname(dir);
    }
}
