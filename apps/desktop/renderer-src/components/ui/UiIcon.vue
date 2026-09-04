<script setup lang="ts">
import { computed } from 'vue'
import {
  Archive,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Copy,
  CornerUpLeft,
  Eye,
  FileText,
  FolderOpen,
  GitPullRequest,
  History,
  Layers,
  LayoutDashboard,
  Link,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Moon,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Play,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Slash,
  Sun,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from '@lucide/vue'

const props = withDefaults(defineProps<{
  name: string
  size?: number
}>(), {
  size: 16,
})

const iconComponents: Record<string, unknown> = {
  alertTriangle: TriangleAlert,
  archive: Archive,
  bookOpen: BookOpen,
  braces: Braces,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  circleCheck: CircleCheck,
  circleDot: CircleDot,
  circleX: CircleX,
  clock: Clock,
  copy: Copy,
  cornerUpLeft: CornerUpLeft,
  edit: PenLine,
  eye: Eye,
  fileText: FileText,
  folderOpen: FolderOpen,
  gitPullRequest: GitPullRequest,
  history: History,
  link: Link,
  layers: Layers,
  layoutDashboard: LayoutDashboard,
  listChecks: ListChecks,
  messageCircle: MessageCircle,
  messagesSquare: MessagesSquare,
  moon: Moon,
  maximize: Maximize2,
  minimize: Minimize2,
  panelRightClose: PanelRightClose,
  panelRightOpen: PanelRightOpen,
  play: Play,
  pin: Pin,
  pinOff: PinOff,
  plus: Plus,
  refresh: RefreshCw,
  rotateLeft: RotateCcw,
  scrollText: ScrollText,
  search: Search,
  shield: ShieldCheck,
  slash: Slash,
  sun: Sun,
  tag: Tag,
  trash: Trash2,
  x: X,
}

const iconComponent = computed(() => iconComponents[props.name] || CircleDot)
</script>

<template>
  <span class="ui-icon" aria-hidden="true">
    <component :is="iconComponent" :size="props.size" :stroke-width="1.8" />
  </span>
</template>
