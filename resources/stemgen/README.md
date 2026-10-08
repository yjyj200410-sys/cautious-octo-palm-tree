# Embedded StemgenRT trial

Model: StemgenRT v0.6.2 / teacher004 EMA, downloaded from the official Windows release.
Source: https://github.com/sweetspotsoundsystem/stemgen-rt/releases/tag/v0.6.2
Model SHA-256: 77164d6a581fafb2a31f53fd8ffde44c07cf618472952a4cdba14e68dda3b8b9
Release ZIP SHA-256: a9c4befeec59fb548ce91d05f46bd6ad4f0a882f441fccc52ffc986fd3d68816

The model is MIT licensed; see LICENSE-StemgenRT.txt. ONNX Runtime / onnxruntime-node
1.26.0 is distributed under Microsoft's MIT license, retained in its npm package.
The VST3 / JUCE binary is not embedded. The player runs the graph directly in a
dedicated Node worker with two bounded CPU inference threads, spinning disabled.

Input: stereo 44.1 kHz, 128 samples/hop, eight recurrent states.
Native source order: drums, bass, vocals, other. The graph emits the previous hop.
The player first decodes a complete track with bundled FFmpeg and runs the model
in bounded 1024-sample batches. It writes a four-channel, 32-bit float WAV cache:
dry left/right followed by vocals left/right. The previous-hop output is aligned
to the original sample clock, including the final flush, and the upstream linked
near-silence confidence envelope suppresses the vocal silence floor.

Playback starts after this cache is complete. One AudioWorklet remixes the four
channels without inference or a scheduling delay; seek, pause and playback speed
all use the same HTML media clock. The next queue track is then prepared in the
background. A new foreground request preempts other processing. Completed caches
survive restarts; local file size/mtime and the model checksum invalidate entries.
Online full tracks and trial previews use separate song-id cache identities.
The cache uses about 42.3 MB per minute of audio; old entries are evicted beyond
2 GiB while retaining the current and next track. Disabled mode cancels work and
plays the cached dry channels or the original source. Model workers exit after
each job. This trial currently targets Windows x64.
