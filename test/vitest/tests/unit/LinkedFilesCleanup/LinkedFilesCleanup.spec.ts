import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import GameManager from '../../../../../src/model/game/GameManager';
import Game from '../../../../../src/model/game/Game';
import FsProvider from '../../../../../src/providers/generic/file/FsProvider';
import LoggerProvider from '../../../../../src/providers/ror2/logging/LoggerProvider';
import InteractionProvider from '../../../../../src/providers/ror2/system/InteractionProvider';
import { provideAppWindowImplementation } from '../../../../../src/providers/node/app/app_window';
import { provideChildProcessImplementation } from '../../../../../src/providers/node/child_process/child_process';
import { providePathImplementation } from '../../../../../src/providers/node/path/path';
import ManagerSettings from '../../../../../src/r2mm/manager/ManagerSettings';
import { updateEcosystemReactives } from '../../../../../src/r2mm/ecosystem/EcosystemSchema';
import {
    isGameRunning,
    removeLinkedFilesOnGameExit,
    removesLinkedFilesOnExit
} from '../../../../../src/r2mm/launching/LinkedFilesCleanup';
import InMemoryFsProvider from '../../../stubs/providers/InMemory.FsProvider';
import StubInteractionProvider from '../../../stubs/providers/stub.InteractionProvider';
import StubLoggerProvider from '../../../stubs/providers/stub.LoggerProvider';
import { TestPathProvider } from '../../../stubs/providers/node/Node.Path.Provider';

let phasmophobia!: Game;
let riskOfRain2!: Game;
let processList = '';

function provideProcessList(platform: string, env: Record<string, string> = {}) {
    provideAppWindowImplementation(() => ({ getPlatform: () => platform }));
    const execFile = vi.fn(async () => processList);
    provideChildProcessImplementation(() => ({
        execSync: () => '',
        exec: async () => {},
        execFile,
        spawnSync: () => '',
    }));
    vi.spyOn(InteractionProvider.instance, 'getEnvironmentVariables').mockResolvedValue(env);
    return execFile;
}

beforeAll(async () => {
    providePathImplementation(() => TestPathProvider);
    FsProvider.provide(() => new InMemoryFsProvider());
    await updateEcosystemReactives();
    phasmophobia = GameManager.findByFolderName('Phasmophobia')!;
    riskOfRain2 = GameManager.findByFolderName('RiskOfRain2')!;
});

beforeEach(() => {
    const logger = new StubLoggerProvider();
    vi.spyOn(logger, 'Log').mockImplementation(() => {});
    LoggerProvider.provide(() => logger);
    const interaction = new StubInteractionProvider();
    InteractionProvider.provide(() => interaction);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('removesLinkedFilesOnExit', () => {
    test('Follows the schema', () => {
        expect(removesLinkedFilesOnExit(phasmophobia)).toBe(true);
        expect(removesLinkedFilesOnExit(riskOfRain2)).toBe(false);
    });
});

describe('isGameRunning', () => {
    test('Reads the image names from tasklist on Windows', async () => {
        const execFile = provideProcessList('win32');
        processList = '"System","4","Services","0","148 K"\r\n"Phasmophobia.exe","1234","Console","1","2,000,000 K"\r\n';
        expect(await isGameRunning(phasmophobia)).toBe(true);
        expect(execFile).toHaveBeenCalledWith('tasklist', ['/FO', 'CSV', '/NH']);

        processList = '"System","4","Services","0","148 K"\r\n"NotPhasmophobia.exe","1234","Console","1","2,000 K"\r\n';
        expect(await isGameRunning(phasmophobia)).toBe(false);
    });

    test('Finds the exe in the arguments of Proton processes', async () => {
        const execFile = provideProcessList('linux');
        processList = '/usr/lib/systemd/systemd --user\n'
            + 'Z:\\home\\user\\.steam\\steam\\steamapps\\common\\Phasmophobia\\Phasmophobia.exe --doorstop-enabled true\n';
        expect(await isGameRunning(phasmophobia)).toBe(true);
        expect(execFile).toHaveBeenCalledWith('ps', ['-A', '-o', 'args=']);

        processList = '/usr/bin/steam\n/home/user/Games/Phasmophobia.exe.bak/run\n';
        expect(await isGameRunning(phasmophobia)).toBe(false);

        processList = '/usr/bin/steam\n/home/user/NotPhasmophobia.exe\n';
        expect(await isGameRunning(phasmophobia)).toBe(false);
    });

    test('Lists the host processes from the Flatpak sandbox', async () => {
        const execFile = provideProcessList('linux', { FLATPAK_ID: 'io.github.ebkr.r2modman' });
        processList = '';
        await isGameRunning(phasmophobia);
        expect(execFile).toHaveBeenCalledWith('flatpak-spawn', ['--host', 'ps', '-A', '-o', 'args=']);
    });

    test('Takes a failed listing as not running', async () => {
        const execFile = provideProcessList('win32');
        execFile.mockRejectedValue(new Error('tasklist not found'));
        expect(await isGameRunning(phasmophobia)).toBe(false);
    });
});

describe('removeLinkedFilesOnGameExit', () => {
    const gameDirectory = path.join('GAME', 'Phasmophobia');
    const linkedFiles = [
        path.join(gameDirectory, 'winhttp.dll'),
        path.join(gameDirectory, 'doorstop_config.ini'),
        path.join(gameDirectory, 'dotnet', 'coreclr.dll'),
        path.join(gameDirectory, 'dotnet', 'shared', 'System.dll'),
    ];
    let setLinkedFiles: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        InMemoryFsProvider.clear();
        const fs = FsProvider.instance;
        await fs.mkdirs(path.join(gameDirectory, 'dotnet', 'shared'));
        await fs.mkdirs(path.join(gameDirectory, 'Phasmophobia_Data'));
        await fs.writeFile(path.join(gameDirectory, 'Phasmophobia.exe'), 'game');
        for (const file of linkedFiles) {
            await fs.writeFile(file, 'linked');
        }
        setLinkedFiles = vi.fn(async () => {});
        vi.spyOn(ManagerSettings, 'getSingleton').mockResolvedValue({
            getContext: () => ({ gameSpecific: { gameDirectory, linkedFiles } }),
            setLinkedFiles,
        } as unknown as ManagerSettings);
        GameManager.activeGame = phasmophobia;
    });

    test('Removes the linked files and the folders they leave empty when the game is not running', async () => {
        provideProcessList('win32');
        processList = '"System","4","Services","0","148 K"\r\n';

        await removeLinkedFilesOnGameExit(phasmophobia, 0);

        const fs = FsProvider.instance;
        for (const file of linkedFiles) {
            expect(await fs.exists(file)).toBe(false);
        }
        expect(await fs.exists(path.join(gameDirectory, 'dotnet'))).toBe(false);
        expect(await fs.exists(path.join(gameDirectory, 'Phasmophobia.exe'))).toBe(true);
        expect(await fs.exists(path.join(gameDirectory, 'Phasmophobia_Data'))).toBe(true);
        expect(setLinkedFiles).toHaveBeenCalledWith([]);
    });

    test('Waits for the game to exit', async () => {
        vi.useFakeTimers();
        try {
            provideProcessList('win32');
            processList = '"Phasmophobia.exe","1234","Console","1","2,000,000 K"\r\n';

            const done = removeLinkedFilesOnGameExit(phasmophobia, 0);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(await FsProvider.instance.exists(linkedFiles[0]!)).toBe(true);

            processList = '';
            await vi.advanceTimersByTimeAsync(10_000);
            await done;
            expect(await FsProvider.instance.exists(linkedFiles[0]!)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test('Leaves the files of other games', async () => {
        provideProcessList('win32');
        processList = '';

        await removeLinkedFilesOnGameExit(riskOfRain2, 0);

        expect(await FsProvider.instance.exists(linkedFiles[0]!)).toBe(true);
    });
});
