/**
 * @proctira/ui-components — shared shadcn/ui primitives for the ProctiraERP
 * Unified Platform.
 *
 * Each module re-exports the canonical shadcn/ui surface (Button, Card,
 * Dialog, Sheet, Combobox shells, etc.). The reference design at
 * `School Platform Design/src/app/components/ui/` remains untouched as
 * the visual source of truth; this package is the production
 * implementation consumed by `apps/web/` (and other future apps).
 *
 * See `packages/ui/README.md` for guidance on motion, theming, and how
 * downstream packages should depend on this module.
 *
 * Validates Task 60.1.
 */

// Layout / surfaces
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card';
export { Separator } from './Separator';
export { ScrollArea, ScrollBar } from './ScrollArea';
export { Skeleton } from './Skeleton';

// Form controls
export { Button, buttonVariants, type ButtonProps } from './Button';
export { Input, Textarea, type InputProps, type TextareaProps } from './Input';
export { Label } from './Label';
export { Checkbox } from './Checkbox';
export { RadioGroup, RadioGroupItem } from './RadioGroup';
export { Switch } from './Switch';
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from './Select';
export { FormField, type FormFieldProps } from './FormField';
export {
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField as RHFFormField,
  useFormField,
} from './Form';

// Overlay / disclosure
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './Dialog';
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './Sheet';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './DropdownMenu';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './Popover';
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './Tooltip';

// Display
export { Alert, AlertTitle, AlertDescription } from './Alert';
export { Badge, badgeVariants, type BadgeProps } from './Badge';
export { Avatar, AvatarImage, AvatarFallback } from './Avatar';
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './Accordion';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './Table';

// Command / Combobox
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from './Command';

// Toast surface (mount once at app root)
export { Toaster } from './Sonner';

// Global ARIA live regions + screen-reader announcement hook (mount once
// at app root, inside <AppShell>).
// Validates: Requirements 37.4, 37.6, 38.6 — Design L. Task 54.7.
export {
  LiveRegion,
  useAnnounce,
  announce,
  type AnnouncePriority,
  type Announce,
  type LiveRegionProps,
} from './LiveRegion';

// Auth-specific primitives used by `<SignUp>` (Task 49.2) and the
// password change / reset surfaces. Locale-agnostic — callers supply the
// already-translated copy.
export { RolePicker, type RolePickerProps, type RolePickerRole } from './RolePicker';
export {
  PasswordStrengthMeter,
  type PasswordStrengthMeterProps,
  type PasswordGrade,
  type PasswordRating,
  type PasswordStrengthRule,
} from './PasswordStrengthMeter';
export { MfaCodeInput, sanitizeOtp, type MfaCodeInputProps } from './MfaCodeInput';

// ProctiraERP-specific image wrapper (preserved from the original package).
export { Img, type ImgProps } from './Img';

// RTL-aware wrapper for directional lucide icons (Task 48.3, Requirements
// 18.7, 18.10, 18.11). Use only for icons whose meaning depends on text
// direction (ChevronRight, ArrowLeft, IndentIncrease, …). Direction-neutral
// icons (Search, User, Calendar, …) MUST bypass the wrapper.
export { DirectionalIcon, type DirectionalIconProps } from './DirectionalIcon';

// Token-driven Recharts wrappers (Task 47.3). Also available at the
// `@proctira/ui-components/charts` subpath for consumers that prefer the
// scoped import.
export {
  CHART_TOKEN_NAMES,
  CHART_SERIES_LENGTH,
  ThemedXAxis,
  ThemedYAxis,
  ThemedCartesianGrid,
  ThemedTooltip,
  ThemedSeries,
  pickSeriesColor,
  resolveChartPalette,
  useChartPalette,
  useSeriesColor,
  useSeriesColors,
  type ChartPalette,
  type ChartTokenName,
} from './charts';
