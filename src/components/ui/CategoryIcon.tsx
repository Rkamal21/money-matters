import {
  Award,
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  CalendarCheck,
  Car,
  Circle,
  CirclePlus,
  Clapperboard,
  Coffee,
  CreditCard,
  Dumbbell,
  Ellipsis,
  Flame,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  HeartPulse,
  Hotel,
  House,
  Landmark,
  Laptop,
  LayoutGrid,
  type LucideIcon,
  Music,
  PawPrint,
  PenLine,
  PiggyBank,
  Plane,
  Receipt,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Stethoscope,
  Tag,
  Target,
  TrainFront,
  TrendingUp,
  Trophy,
  User,
  Utensils,
  Wallet,
  Wifi,
  Zap,
} from 'lucide-react'

import { createElement } from 'react'

import { cn } from '@/lib/cn'

/**
 * Category and achievement icons. A category stores a lucide icon *name* and a
 * colour *token* (DATABASE.md §6.3), so theming stays in one place; this is
 * the one map from name to glyph. An unknown name falls back to a circle
 * rather than rendering nothing.
 */
export const ICONS: Readonly<Record<string, LucideIcon>> = {
  utensils: Utensils,
  coffee: Coffee,
  car: Car,
  bus: Bus,
  'train-front': TrainFront,
  fuel: Fuel,
  plane: Plane,
  hotel: Hotel,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  gift: Gift,
  receipt: Receipt,
  house: House,
  zap: Zap,
  wifi: Wifi,
  smartphone: Smartphone,
  clapperboard: Clapperboard,
  music: Music,
  'gamepad-2': Gamepad2,
  'heart-pulse': HeartPulse,
  stethoscope: Stethoscope,
  dumbbell: Dumbbell,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  laptop: Laptop,
  user: User,
  baby: Baby,
  'paw-print': PawPrint,
  heart: Heart,
  sparkles: Sparkles,
  tag: Tag,
  circle: Circle,
  briefcase: Briefcase,
  'circle-plus': CirclePlus,
  banknote: Banknote,
  'trending-up': TrendingUp,
  landmark: Landmark,
  wallet: Wallet,
  'credit-card': CreditCard,
  'piggy-bank': PiggyBank,
  target: Target,
  trophy: Trophy,
  flame: Flame,
  'pen-line': PenLine,
  'calendar-check': CalendarCheck,
  'layout-grid': LayoutGrid,
  'shield-check': ShieldCheck,
  award: Award,
  ellipsis: Ellipsis,
}

/** The icons a user may pick for a category. */
export const CATEGORY_ICON_CHOICES = [
  'utensils',
  'coffee',
  'car',
  'bus',
  'fuel',
  'plane',
  'hotel',
  'shopping-bag',
  'shirt',
  'gift',
  'receipt',
  'house',
  'zap',
  'wifi',
  'smartphone',
  'clapperboard',
  'music',
  'gamepad-2',
  'heart-pulse',
  'dumbbell',
  'graduation-cap',
  'book-open',
  'laptop',
  'user',
  'baby',
  'paw-print',
  'heart',
  'sparkles',
  'tag',
  'briefcase',
  'banknote',
  'trending-up',
  'circle',
] as const

/** Colour tokens, as static class names so Tailwind generates them. */
const CHIP: Readonly<Record<string, string>> = {
  orange: 'bg-cat-orange/15 text-cat-orange',
  blue: 'bg-cat-blue/15 text-cat-blue',
  pink: 'bg-cat-pink/15 text-cat-pink',
  slate: 'bg-cat-slate/15 text-cat-slate',
  purple: 'bg-cat-purple/15 text-cat-purple',
  red: 'bg-cat-red/15 text-cat-red',
  teal: 'bg-cat-teal/15 text-cat-teal',
  sky: 'bg-cat-sky/15 text-cat-sky',
  amber: 'bg-cat-amber/15 text-cat-amber',
  green: 'bg-cat-green/15 text-cat-green',
  emerald: 'bg-cat-emerald/15 text-cat-emerald',
  neutral: 'bg-cat-neutral/15 text-cat-neutral',
}

/** The same tokens as SVG fills, for chart slices. */
export const CATEGORY_FILL: Readonly<Record<string, string>> = {
  orange: 'fill-cat-orange',
  blue: 'fill-cat-blue',
  pink: 'fill-cat-pink',
  slate: 'fill-cat-slate',
  purple: 'fill-cat-purple',
  red: 'fill-cat-red',
  teal: 'fill-cat-teal',
  sky: 'fill-cat-sky',
  amber: 'fill-cat-amber',
  green: 'fill-cat-green',
  emerald: 'fill-cat-emerald',
  neutral: 'fill-cat-neutral',
}

/** The same tokens as SVG strokes, for donut arcs. Literal, so Tailwind generates each one. */
export const CATEGORY_STROKE: Readonly<Record<string, string>> = {
  orange: 'stroke-cat-orange',
  blue: 'stroke-cat-blue',
  pink: 'stroke-cat-pink',
  slate: 'stroke-cat-slate',
  purple: 'stroke-cat-purple',
  red: 'stroke-cat-red',
  teal: 'stroke-cat-teal',
  sky: 'stroke-cat-sky',
  amber: 'stroke-cat-amber',
  green: 'stroke-cat-green',
  emerald: 'stroke-cat-emerald',
  neutral: 'stroke-cat-neutral',
}

export const CATEGORY_SWATCH: Readonly<Record<string, string>> = {
  orange: 'bg-cat-orange',
  blue: 'bg-cat-blue',
  pink: 'bg-cat-pink',
  slate: 'bg-cat-slate',
  purple: 'bg-cat-purple',
  red: 'bg-cat-red',
  teal: 'bg-cat-teal',
  sky: 'bg-cat-sky',
  amber: 'bg-cat-amber',
  green: 'bg-cat-green',
  emerald: 'bg-cat-emerald',
  neutral: 'bg-cat-neutral',
}

export const CATEGORY_COLOR_CHOICES = Object.keys(CHIP)

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? Circle
}

/**
 * An icon by stored name. The glyph components themselves are all defined at
 * module level (the imports above); this only chooses one, so React never
 * sees a component type created during render.
 */
export function Glyph({
  name,
  className,
}: {
  readonly name: string | null | undefined
  readonly className?: string
}) {
  return createElement(iconFor(name), {
    'aria-hidden': true,
    ...(className === undefined ? {} : { className }),
  })
}

export function CategoryIcon({
  icon,
  color,
  size = 'md',
  className,
}: {
  readonly icon: string | null | undefined
  readonly color: string | null | undefined
  readonly size?: 'sm' | 'md' | 'lg'
  readonly className?: string
}) {
  const chip = (color ? CHIP[color] : undefined) ?? CHIP['neutral']
  return (
    <span
      aria-hidden="true"
      className={cn(
        // A tinted square tile, as in the reference design — not a circle.
        'inline-flex shrink-0 items-center justify-center',
        size === 'sm'
          ? 'size-8 rounded-lg'
          : size === 'lg'
            ? 'size-12 rounded-xl'
            : 'size-11 rounded-xl',
        chip,
        className,
      )}
    >
      <Glyph
        name={icon}
        className={size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-5'}
      />
    </span>
  )
}
