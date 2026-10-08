/** Trial completion must advance, even when metadata describes the full song. */
export function getPlaybackEndBehavior(
  isTrial: boolean,
  currentTime: number,
  duration: number,
  repeatOne: boolean
): 'recover' | 'repeat' | 'advance' {
  if (isTrial) return 'advance';
  if (duration > 0 && currentTime < duration - 3) return 'recover';
  return repeatOne ? 'repeat' : 'advance';
}