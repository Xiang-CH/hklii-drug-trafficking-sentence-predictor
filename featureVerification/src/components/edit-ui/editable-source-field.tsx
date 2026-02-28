import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'

interface EditableSourceFieldProps {
  source: string
  onHover: (text: string | null) => void
  onChange: (value: string) => void
  isEditing: boolean
}

export function EditableSourceField({
  source,
  onHover,
  onChange,
  isEditing,
}: EditableSourceFieldProps) {
  const [isEditingSource, setIsEditingSource] = useState(false)
  const [editValue, setEditValue] = useState(source)

  useEffect(() => {
    setEditValue(source)
  }, [source])

  if (!isEditing) {
    return (
      <span
        className="inline-block text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded cursor-help hover:bg-green-100 dark:hover:bg-green-900/50 transition-all border border-green-200 dark:border-green-800 hover:border-green-400 dark:hover:border-green-600"
        onMouseEnter={() => onHover(source)}
        onMouseLeave={() => onHover(null)}
        title="Hover to highlight source text in HTML"
      >
        <span className="text-xs text-green-600 dark:text-green-400 mr-1">
          📎
        </span>
        "{source.substring(0, 100)}
        {source.length > 100 ? '...' : ''}"
      </span>
    )
  }

  if (isEditingSource) {
    return (
      <div className="flex flex-col gap-2 w-full">
        <textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm min-h-[80px]"
          autoFocus
          placeholder="Enter source text..."
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              onChange(editValue)
              setIsEditingSource(false)
            }}
            className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            Save
          </button>
          <button
            onClick={() => {
              setEditValue(source)
              setIsEditingSource(false)
            }}
            className="px-2 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <span
      className="inline-block text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/50 transition-all border border-green-200 dark:border-green-800 hover:border-green-400 dark:hover:border-green-600"
      onMouseEnter={() => onHover(source)}
      onMouseLeave={() => onHover(null)}
      onClick={() => setIsEditingSource(true)}
      title="Click to edit source text, hover to highlight in HTML"
    >
      <span className="text-xs text-green-600 dark:text-green-400 mr-1">
        📎
      </span>
      "{source.substring(0, 100)}
      {source.length > 100 ? '...' : ''}"
    </span>
  )
}
