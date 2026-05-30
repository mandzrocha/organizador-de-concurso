import { Play, BookOpen, PenLine, RotateCw } from 'lucide-react'
import type { ActivityType } from './types'

type IconProps = { size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }

export const ACTIVITY_ICON_MAP: Record<ActivityType, React.ComponentType<IconProps>> = {
  video: Play,
  reading: BookOpen,
  exercises: PenLine,
  review: RotateCw,
}

export function ActivityIcon({ type, ...props }: { type: ActivityType } & IconProps) {
  const Icon = ACTIVITY_ICON_MAP[type]
  return <Icon {...props} />
}
