import * as path from 'path';
import { describe, beforeEach, afterEach, test, expect } from 'vitest';
import InMemoryFsProvider from '../../../../stubs/providers/InMemory.FsProvider';
import FsProvider from '../../../../../../src/providers/generic/file/FsProvider';
import ManifestV2 from '../../../../../../src/model/ManifestV2';
import Profile from '../../../../../../src/model/Profile';
import ProfileInstallerProvider from '../../../../../../src/providers/ror2/installing/ProfileInstallerProvider';
import {
    createManifest,
    createPackageFilesIntoCache,
    installLogicBeforeEach
} from '../../../../utils/InstallLogicUtils';

describe('Phasmophobia Install Logic', () => {
    let pkg: ManifestV2;
    let boot: string;

    beforeEach(async () => {
        await installLogicBeforeEach('Phasmophobia');
        pkg = createManifest('PhasmaMod', 'PhasmaMod');
        await createPackageFilesIntoCache(pkg, [
            path.join('core', 'Phasma.Boot.dll'),
            path.join('patchers', 'Phasma.Preload.dll'),
            path.join('plugins', 'Phasma.Mod.dll'),
        ]);
        expect(await ProfileInstallerProvider.instance.installMod(pkg, Profile.getActiveProfile().asImmutableProfile())).toBeNull();
        boot = Profile.getActiveProfile().joinToProfilePath('BepInEx', 'core', 'Phasma.Boot.dll');
    });

    afterEach(() => {
        InMemoryFsProvider.clear();
    });

    test('Installs core/ into BepInEx/core itself, and the rest into the package subfolders', async () => {
        const profile = Profile.getActiveProfile();
        expect(await FsProvider.instance.exists(boot)).toBe(true);
        expect(await FsProvider.instance.exists(profile.joinToProfilePath('BepInEx', 'patchers', pkg.getName(), 'Phasma.Preload.dll'))).toBe(true);
        expect(await FsProvider.instance.exists(profile.joinToProfilePath('BepInEx', 'plugins', pkg.getName(), 'Phasma.Mod.dll'))).toBe(true);
    });

    test('Removes the core/ files when the package is disabled or uninstalled', async () => {
        const profile = Profile.getActiveProfile().asImmutableProfile();

        await ProfileInstallerProvider.instance.disableMod(pkg, profile);
        expect(await FsProvider.instance.exists(boot)).toBe(false);

        await ProfileInstallerProvider.instance.enableMod(pkg, profile);
        expect(await FsProvider.instance.exists(boot)).toBe(true);

        expect(await ProfileInstallerProvider.instance.uninstallMod(pkg, profile)).toBeNull();
        expect(await FsProvider.instance.exists(boot)).toBe(false);
    });
});
