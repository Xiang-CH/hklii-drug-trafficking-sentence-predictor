import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { EditableDataObject } from './editable-data-object'
import type { UndoState } from '@/components/editable-data-viewer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type EditableDataSectionKey = 'judgement' | 'defendants' | 'trials'

interface EditableDataSectionProps {
  sectionKey: EditableDataSectionKey
  title: string
  data: any
  onSourceHover: (text: string | null) => void
  isEditing: boolean
  onChange: (data: any) => void
  onRestoreDefault?: (section: EditableDataSectionKey) => void
  canRestore?: boolean
  notGivenMap: Record<string, boolean>
  onToggleNotGiven: (path: string, next: boolean) => void
  lastCleared: UndoState
  onClearField: (path: string, previousValue: any) => void
  onUndoClear: () => void
  onRemoveItem: (path: string, index: number, removedItem: any) => void
  onUndoRemove: () => void
}

export function EditableDataSection({
  sectionKey,
  title,
  data,
  onSourceHover,
  isEditing,
  onChange,
  onRestoreDefault,
  canRestore = false,
  notGivenMap,
  onToggleNotGiven,
  lastCleared,
  onClearField,
  onUndoClear,
  onRemoveItem,
  onUndoRemove,
}: EditableDataSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false)

  const rootPath = title.toLowerCase()

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-between gap-4 text-gray-900 dark:text-white">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left font-semibold"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0" />
          )}
          <span>{title}</span>
        </button>
        {canRestore && onRestoreDefault ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setIsRestoreDialogOpen(true)
            }}
            className="shrink-0 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline hover:cursor-pointer"
          >
            Restore default
          </button>
        ) : null}
      </div>
      {isExpanded && (
        <div className="p-4">
          <EditableDataObject
            data={data}
            onSourceHover={onSourceHover}
            isEditing={isEditing}
            onChange={onChange}
            parentField={rootPath}
            path={rootPath}
            notGivenMap={notGivenMap}
            onToggleNotGiven={onToggleNotGiven}
            lastCleared={lastCleared}
            onClearField={onClearField}
            onUndoClear={onUndoClear}
            onRemoveItem={onRemoveItem}
            onUndoRemove={onUndoRemove}
          />
        </div>
      )}
      <Dialog open={isRestoreDialogOpen} onOpenChange={setIsRestoreDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Restore {title} defaults?</DialogTitle>
            <DialogDescription>
              This will replace the current {title.toLowerCase()} data with the
              original LLM-extracted values for this section only.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRestoreDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onRestoreDefault?.(sectionKey)
                setIsRestoreDialogOpen(false)
              }}
            >
              Restore default
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
