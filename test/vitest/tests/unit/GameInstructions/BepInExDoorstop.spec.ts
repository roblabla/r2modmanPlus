import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import GameManager from '../../../../../src/model/game/GameManager';
import Game from '../../../../../src/model/game/Game';
import Profile from '../../../../../src/model/Profile';
import FsProvider from '../../../../../src/providers/generic/file/FsProvider';
import { provideAppWindowImplementation } from '../../../../../src/providers/node/app/app_window';
import { providePathImplementation } from '../../../../../src/providers/node/path/path';
import { updateEcosystemReactives } from '../../../../../src/r2mm/ecosystem/EcosystemSchema';
import BepInExGameInstructions from '../../../../../src/r2mm/launching/instructions/instructions/loader/BepInExGameInstructions';
import InMemoryFsProvider from '../../../stubs/providers/InMemory.FsProvider';
import { TestPathProvider } from '../../../stubs/providers/node/Node.Path.Provider';

let phasmophobia!: Game;
const profile = new Profile('Default');

beforeAll(async () => {
    providePathImplementation(() => TestPathProvider);
    FsProvider.provide(() => new InMemoryFsProvider());
    await updateEcosystemReactives();
    phasmophobia = GameManager.findByFolderName('Phasmophobia')!;
});

beforeEach(() => {
    provideAppWindowImplementation(() => ({ getPlatform: () => 'win32' }));
    InMemoryFsProvider.clear();
});

describe('BepInExGameInstructions', () => {
    test('Disables Doorstop 4 for a vanilla start', async () => {
        await FsProvider.instance.mkdirs(profile.getProfilePath());
        await FsProvider.instance.writeFile(profile.joinToProfilePath('.doorstop_version'), '4.6.0');

        const instructions = await new BepInExGameInstructions().generate(phasmophobia, profile);

        expect(instructions.vanillaParameterList).toStrictEqual(['--doorstop-enabled', 'false']);
    });
});
