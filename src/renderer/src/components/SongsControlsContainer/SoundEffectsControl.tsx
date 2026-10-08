import * as Popover from '@radix-ui/react-popover';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { Icon } from '@phosphor-icons/react';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { AtomIcon } from '@phosphor-icons/react/dist/csr/Atom';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CassetteTapeIcon } from '@phosphor-icons/react/dist/csr/CassetteTape';
import { DiscIcon } from '@phosphor-icons/react/dist/csr/Disc';
import { SpeakerSimpleHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerSimpleHigh';
import { CirclesThreeIcon } from '@phosphor-icons/react/dist/csr/CirclesThree';
import { DiscoBallIcon } from '@phosphor-icons/react/dist/csr/DiscoBall';
import { EqualizerIcon } from '@phosphor-icons/react/dist/csr/Equalizer';
import { FireIcon } from '@phosphor-icons/react/dist/csr/Fire';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { GuitarIcon } from '@phosphor-icons/react/dist/csr/Guitar';
import { HeadphonesIcon } from '@phosphor-icons/react/dist/csr/Headphones';
import { MicrophoneIcon } from '@phosphor-icons/react/dist/csr/Microphone';
import { MusicNotesIcon } from '@phosphor-icons/react/dist/csr/MusicNotes';
import { PianoKeysIcon } from '@phosphor-icons/react/dist/csr/PianoKeys';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { RadioIcon } from '@phosphor-icons/react/dist/csr/Radio';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { VinylRecordIcon } from '@phosphor-icons/react/dist/csr/VinylRecord';
import { WaveSineIcon } from '@phosphor-icons/react/dist/csr/WaveSine';
import { WaveformIcon } from '@phosphor-icons/react/dist/csr/Waveform';
import { WavesIcon } from '@phosphor-icons/react/dist/csr/Waves';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { equalizerPresetsData } from '../../other/equalizerData';
import type { SpecialEffectMode } from '../../other/player';

import { userPreferencesQuery } from '../../queries/userPreferences';
import {
  readSavedEqualizers, readSpecialEffect, writeSavedEqualizers, writeSpecialEffect,
  type SavedEqualizerPreset
} from '../../utils/soundEffectPresets';

const bandLabels = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const bandKeys: (keyof Equalizer)[] = [
  'thirtyTwoHertzFilter', 'sixtyFourHertzFilter', 'hundredTwentyFiveHertzFilter',
  'twoHundredFiftyHertzFilter', 'fiveHundredHertzFilter', 'thousandHertzFilter',
  'twoThousandHertzFilter', 'fourThousandHertzFilter', 'eightThousandHertzFilter',
  'sixteenThousandHertzFilter'
];
const specialModes: Exclude<SpecialEffectMode, 'none'>[] = [
  'studio', 'spatial', 'rotate3d', 'wide', 'chorus', 'phaser',
  'gramophone', 'vinyl', 'cassette', 'radio', 'cd'
];
const equalizerModes = [
  'flat', 'bassBooster', 'vocalBooster', 'acoustic', 'classical', 'electronic',
  'hipHop', 'jazz', 'pop', 'rock', 'live'
] as const;
type EqualizerMode = (typeof equalizerModes)[number];

const specialIcons: Record<Exclude<SpecialEffectMode, 'none'>, Icon> = {
  studio: PulseIcon,
  spatial: WavesIcon,
  rotate3d: ArrowsClockwiseIcon,
  wide: WaveformIcon,
  chorus: CirclesThreeIcon,
  phaser: WaveSineIcon,
  gramophone: SpeakerSimpleHighIcon,
  vinyl: VinylRecordIcon,
  cassette: CassetteTapeIcon,
  radio: RadioIcon,
  cd: DiscIcon
};
const equalizerIcons: Record<EqualizerMode, Icon> = {
  flat: HeadphonesIcon,
  bassBooster: FireIcon,
  vocalBooster: MicrophoneIcon,
  acoustic: GuitarIcon,
  classical: PianoKeysIcon,
  electronic: AtomIcon,
  hipHop: RadioIcon,
  jazz: VinylRecordIcon,
  pop: MusicNotesIcon,
  rock: PulseIcon,
  live: DiscoBallIcon
};

const presetBands = (mode: EqualizerMode): number[] => {
  const preset = equalizerPresetsData.find((item) => item.title === mode)?.preset;
  return bandKeys.map((key) => preset?.[key] ?? 0);
};

const tileClass = 'sound-effect-tile flex aspect-square min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/6 p-1.5 text-white/68 transition-[background,border-color,color,transform] hover:-translate-y-0.5 hover:bg-white/13 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 data-[state=on]:border-white/35 data-[state=on]:bg-white/20 data-[state=on]:text-white';

const SoundEffectsControl = () => {
  const { t } = useTranslation();
  const player = useAudioPlayer();
  const { data: saved } = useQuery(userPreferencesQuery.equalizerPreset);
  const [enabled, setEnabled] = useState(false);
  const [specialMode, setSpecialMode] = useState<SpecialEffectMode>('none');
  const [equalizerSelection, setEqualizerSelection] = useState('flat');
  const [bands, setBands] = useState<number[]>(() => presetBands('flat'));
  const [savedEqualizers, setSavedEqualizers] = useState(readSavedEqualizers);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'effects' | 'equalizer'>('effects');
  const [isSaving, setIsSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [saveError, setSaveError] = useState('');
  const hydrated = useRef(false);
  const skipSave = useRef(false);

  useEffect(() => {
    if (!saved || hydrated.current) return;
    const previousMode = saved.presetName as SpecialEffectMode;
    const special = readSpecialEffect() ??
      (previousMode !== 'none' && specialModes.includes(previousMode) ? previousMode : 'none');
    const equalizer = equalizerModes.includes(saved.presetName as EqualizerMode) ||
      savedEqualizers.some((item) => `saved:${item.id}` === saved.presetName)
      ? saved.presetName : 'custom';
    const nextBands = saved.frequencyBands?.length === bandKeys.length
      ? saved.frequencyBands.map((value) => Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0)
      : presetBands('flat');
    hydrated.current = true;
    skipSave.current = true;
    setSpecialMode(special);
    setEqualizerSelection(equalizer);
    setBands(nextBands);
    setEnabled(saved.isEnabled ?? false);
    player.setSoundEffects(saved.isEnabled ?? false, special, nextBands);
  }, [saved, savedEqualizers, player]);

  useEffect(() => {
    if (!hydrated.current) return;
    player.setSoundEffects(enabled, specialMode, bands);
    writeSpecialEffect(specialMode);
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void window.api.settingsHelpers.saveUserEqualizerPreset({
        presetName: equalizerSelection,
        frequencyBands: bands,
        isEnabled: enabled
      }).catch((error) => console.error('Failed to save sound effects', error));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [enabled, specialMode, equalizerSelection, bands, player]);

  const specialLabels: Record<Exclude<SpecialEffectMode, 'none'>, string> = {
    studio: t('soundEffects.studio'),
    spatial: t('soundEffects.spatial'),
    rotate3d: t('soundEffects.rotate3d'),
    wide: t('soundEffects.wide'),
    chorus: t('soundEffects.chorus'),
    phaser: t('soundEffects.phaser'),
    gramophone: t('soundEffects.gramophone', { defaultValue: 'Gramophone' }),
    vinyl: t('soundEffects.vinyl', { defaultValue: 'Vinyl' }),
    cassette: t('soundEffects.cassette', { defaultValue: 'Cassette' }),
    radio: t('soundEffects.radio', { defaultValue: 'Vintage radio' }),
    cd: t('soundEffects.cd', { defaultValue: 'CD player' })
  };
  const equalizerLabels: Record<EqualizerMode, string> = {
    flat: t('equalizerPresets.flat'),
    bassBooster: t('equalizerPresets.bassBooster'),
    vocalBooster: t('equalizerPresets.vocalBooster'),
    acoustic: t('equalizerPresets.acoustic'),
    classical: t('equalizerPresets.classical'),
    electronic: t('equalizerPresets.electronic'),
    hipHop: t('equalizerPresets.hipHop'),
    jazz: t('equalizerPresets.jazz'),
    pop: t('equalizerPresets.pop'),
    rock: t('equalizerPresets.rock'),
    live: t('equalizerPresets.live')
  };
  const selectedEqualizerLabel = equalizerModes.includes(equalizerSelection as EqualizerMode)
    ? equalizerLabels[equalizerSelection as EqualizerMode]
    : savedEqualizers.find((item) => `saved:${item.id}` === equalizerSelection)?.name ?? t('equalizerPresets.custom');

  const saveCustomPreset = () => {
    const name = presetName.trim();
    if (!name) {
      setSaveError(t('soundEffects.nameRequired'));
      return;
    }
    if (savedEqualizers.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setSaveError(t('soundEffects.nameExists'));
      return;
    }
    const preset: SavedEqualizerPreset = {
      id: crypto.randomUUID(),
      name: name.slice(0, 30),
      bands: [...bands]
    };
    const next = [...savedEqualizers, preset];
    if (!writeSavedEqualizers(next)) {
      setSaveError(t('soundEffects.saveFailed'));
      return;
    }
    setSavedEqualizers(next);
    setEqualizerSelection(`saved:${preset.id}`);
    setPresetName('');
    setSaveError('');
    setIsSaving(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setPage('effects');
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`text-font-color-black dark:text-font-color-white flex h-8 items-center justify-center rounded-md border-0 bg-transparent px-2 hover:bg-black/5 dark:hover:bg-white/7 ${open ? 'bg-black/6 dark:bg-white/9' : ''}`}
          title={t('soundEffects.title')}
          aria-label={t('soundEffects.title')}
        >
          <EqualizerIcon size={21} weight="regular" className="opacity-65" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="sound-effects-popup queue-popup-surface z-[80] w-[430px] max-w-[calc(100vw-24px)] rounded-2xl text-white outline-none"
          aria-label={t('soundEffects.title')}
        >
          <div className="max-h-[calc(100vh-80px)] overflow-y-auto p-4 [scrollbar-width:thin]">
            {page === 'effects' ? (
              <div key="effects" className="sound-effects-page">
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm font-semibold text-white/90">{t('soundEffects.title')}</div>
                  <Switch.Root
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    className="relative h-5 w-9 rounded-full bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 data-[state=checked]:bg-white/65"
                    aria-label={t('soundEffects.enable')}
                  >
                    <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
                  </Switch.Root>
                </div>
                <ToggleGroup.Root
                  type="single"
                  value={specialMode}
                  onValueChange={(value) => {
                    if (!value) return;
                    setSpecialMode(value as SpecialEffectMode);
                    if (value !== 'none') setEnabled(true);
                  }}
                  className="grid grid-cols-4 gap-2"
                  aria-label={t('soundEffects.title')}
                >
                  {specialModes.map((value) => {
                    const IconComponent = specialIcons[value];
                    return (
                      <ToggleGroup.Item key={value} value={value} className={tileClass}>
                        <IconComponent size={29} weight="duotone" aria-hidden="true" />
                        <span className="w-full truncate text-center text-[11px] leading-tight">{specialLabels[value]}</span>
                      </ToggleGroup.Item>
                    );
                  })}
                </ToggleGroup.Root>

                <button
                  type="button"
                  className="mt-4 flex h-12 w-full items-center gap-3 rounded-xl border border-white/12 bg-white/8 px-3 text-left transition-colors hover:bg-white/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  onClick={() => setPage('equalizer')}
                >
                  <EqualizerIcon size={24} weight="duotone" className="shrink-0 text-white/85" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{t('soundEffects.equalizer')}</span>
                    <span className="block truncate text-[11px] text-white/50">{selectedEqualizerLabel}</span>
                  </span>
                  <CaretRightIcon size={17} className="text-white/50" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div key="equalizer" className="sound-effects-page">
                <div className="mb-4 flex items-center gap-2">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    onClick={() => setPage('effects')}
                    aria-label={t('soundEffects.back')}
                  >
                    <ArrowLeftIcon size={18} aria-hidden="true" />
                  </button>
                  <span className="text-sm font-semibold text-white/90">{t('soundEffects.equalizer')}</span>
                </div>
                <div className="mb-2 text-xs font-medium text-white/55">{t('soundEffects.presets')}</div>
                <ToggleGroup.Root
                  type="single"
                  value={equalizerSelection}
                  onValueChange={(value) => {
                    if (!value) return;
                    const next = value as EqualizerMode;
                    setEqualizerSelection(next);
                    setBands(presetBands(next));
                    setEnabled(true);
                  }}
                  className="grid grid-cols-4 gap-2"
                  aria-label={t('soundEffects.presets')}
                >
                  {equalizerModes.map((value) => {
                    const IconComponent = equalizerIcons[value];
                    return (
                      <ToggleGroup.Item key={value} value={value} className={tileClass}>
                        <IconComponent size={27} weight="duotone" aria-hidden="true" />
                        <span className="w-full truncate text-center text-[11px] leading-tight">{equalizerLabels[value]}</span>
                      </ToggleGroup.Item>
                    );
                  })}
                </ToggleGroup.Root>

                {savedEqualizers.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-medium text-white/55">{t('soundEffects.savedPresets')}</div>
                    <div className="flex flex-col gap-1">
                      {savedEqualizers.map((preset) => (
                        <div key={preset.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors hover:bg-white/14 ${equalizerSelection === `saved:${preset.id}` ? 'bg-white/20 text-white' : 'bg-white/7 text-white/75'}`}
                            onClick={() => {
                              setEqualizerSelection(`saved:${preset.id}`);
                              setBands([...preset.bands]);
                              setEnabled(true);
                            }}
                          >
                            <FloppyDiskIcon size={17} aria-hidden="true" />
                            <span className="truncate">{preset.name}</span>
                          </button>
                          <button
                            type="button"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/45 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                            aria-label={`${t('soundEffects.deletePreset')} ${preset.name}`}
                            onClick={() => {
                              const next = savedEqualizers.filter((item) => item.id !== preset.id);
                              if (!writeSavedEqualizers(next)) return;
                              setSavedEqualizers(next);
                              if (equalizerSelection === `saved:${preset.id}`) setEqualizerSelection('custom');
                            }}
                          >
                            <TrashIcon size={17} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 mb-2 flex items-baseline justify-between text-xs text-white/60">
                  <span>{t('soundEffects.adjust')}</span>
                  <span>±12 dB</span>
                </div>
                <div className="relative grid grid-cols-10 gap-1 border-t border-white/10 pt-3">
                  {bands.map((gain, index) => (
                    <div key={bandLabels[index]} className="flex min-w-0 flex-col items-center gap-2">
                      <span className="text-[10px] tabular-nums text-white/70">{gain > 0 ? '+' : ''}{Math.round(gain)}</span>
                      <Slider.Root
                        orientation="vertical"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={[gain]}
                        onValueChange={([value]) => {
                          setBands((current) => current.map((item, i) => i === index ? value : item));
                          setEqualizerSelection('custom');
                          setEnabled(true);
                        }}
                        className="relative flex h-28 w-6 touch-none select-none items-center justify-center"
                        aria-label={`${bandLabels[index]} Hz`}
                      >
                        <Slider.Track className="relative h-full w-1 overflow-hidden rounded-full bg-white/18">
                          <Slider.Range className="absolute w-full rounded-full bg-white/70" />
                        </Slider.Track>
                        <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border border-white/70 bg-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white/60" />
                      </Slider.Root>
                      <span className="text-[10px] tabular-nums text-white/50">{bandLabels[index]}</span>
                    </div>
                  ))}
                </div>

                {isSaving ? (
                  <form
                    className="mt-4 flex flex-wrap gap-2"
                    onSubmit={(event) => { event.preventDefault(); saveCustomPreset(); }}
                  >
                    <input
                      maxLength={30}
                      value={presetName}
                      onChange={(event) => { setPresetName(event.target.value); setSaveError(''); }}
                      placeholder={t('soundEffects.presetName')}
                      aria-label={t('soundEffects.presetName')}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-white/18 bg-white/8 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/50"
                    />
                    <button type="submit" className="h-9 rounded-lg bg-white/20 px-3 text-xs hover:bg-white/30">{t('soundEffects.save')}</button>
                    <button type="button" className="h-9 rounded-lg px-2 text-xs text-white/60 hover:text-white" onClick={() => { setIsSaving(false); setSaveError(''); }}>{t('soundEffects.cancel')}</button>
                    {saveError && <div role="alert" className="w-full text-xs text-red-300">{saveError}</div>}
                  </form>
                ) : (
                  <button
                    type="button"
                    className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/8 text-xs text-white/85 hover:bg-white/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    onClick={() => setIsSaving(true)}
                  >
                    <FloppyDiskIcon size={17} aria-hidden="true" />
                    {t('soundEffects.savePreset')}
                  </button>
                )}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default SoundEffectsControl;


