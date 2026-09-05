import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Dumbbell,
  Ellipsis,
  GraduationCap,
  House,
  MapPinned,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  ScanLine,
  Search,
  Share2,
  ShieldCheck,
  Store,
  TicketPercent,
  TriangleAlert,
  Trophy,
  Undo2,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconOutput = path.join(repositoryRoot, 'apps/miniapp/src/static/icons/lucide')
const tabBarOutput = path.join(repositoryRoot, 'apps/miniapp/src/static/tabbar')

const icons = {
  activity: Trophy,
  analytics: ChartNoAxesCombined,
  back: ArrowLeft,
  booking: CalendarDays,
  chevron: ChevronRight,
  clock: Clock3,
  close: X,
  event: Trophy,
  finance: WalletCards,
  governance: ShieldCheck,
  home: House,
  info: CircleHelp,
  inventory: Package,
  members: UsersRound,
  more: Ellipsis,
  notification: Bell,
  profile: UserRound,
  receipt: ReceiptText,
  refresh: RefreshCw,
  refund: Undo2,
  scan: ScanLine,
  search: Search,
  share: Share2,
  shop: Store,
  sport: Dumbbell,
  success: CircleCheck,
  ticket: TicketPercent,
  training: GraduationCap,
  venue: MapPinned,
  warning: TriangleAlert,
  work: ClipboardCheck,
  add: Plus,
}

const tones = {
  primary: '#17653D',
  muted: '#5F6F65',
  inverse: '#FFFFFF',
  accent: '#B68B22',
  danger: '#A52626',
}

function renderIcon(Icon, color, size = 48) {
  return renderToStaticMarkup(
    createElement(Icon, {
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      color,
      strokeWidth: 1.8,
      absoluteStrokeWidth: true,
      'aria-hidden': 'true',
    }),
  )
}

await Promise.all([mkdir(iconOutput, { recursive: true }), mkdir(tabBarOutput, { recursive: true })])

await Promise.all(
  Object.entries(icons).flatMap(([name, Icon]) =>
    Object.entries(tones).map(([tone, color]) =>
      writeFile(path.join(iconOutput, `${name}-${tone}.svg`), `${renderIcon(Icon, color)}\n`),
    ),
  ),
)

const tabBarIcons = {
  home: House,
  booking: CalendarDays,
  activity: Trophy,
  profile: UserRound,
}

await Promise.all(
  Object.entries(tabBarIcons).flatMap(([name, Icon]) => [
    sharp(Buffer.from(renderIcon(Icon, '#7A837D', 81)))
      .png()
      .toFile(path.join(tabBarOutput, `${name}.png`)),
    sharp(Buffer.from(renderIcon(Icon, '#17653D', 81)))
      .png()
      .toFile(path.join(tabBarOutput, `${name}-active.png`)),
  ]),
)

const lucideLicense = await readFile(path.join(repositoryRoot, 'node_modules/lucide-react/LICENSE'), 'utf8')
await writeFile(
  path.join(iconOutput, 'LICENSE.txt'),
  `Lucide icon assets generated for this project.\nSource: https://lucide.dev/\n\n${lucideLicense}`,
)

console.log(`Generated ${Object.keys(icons).length * Object.keys(tones).length} SVG assets and ${Object.keys(tabBarIcons).length * 2} tab bar PNG assets.`)
