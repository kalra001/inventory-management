import { useEffect, useRef, useState } from 'react'

export default function SearchableSelect({ options, value, onChange, placeholder, required, disabled }) {
  const [searchText, setSearchText] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef(null)

  const selected = options.find((o) => String(o.value) === String(value))

  useEffect(() => {
    setSearchText(selected ? selected.label : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options])

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false)
        setSearchText(selected ? selected.label : '')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selected])

  const filtered = options.filter((o) => o.label.toLowerCase().includes(searchText.toLowerCase()))

  function selectOption(option) {
    onChange(option.value)
    setSearchText(option.label)
    setIsOpen(false)
  }

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <input
        type="text"
        value={searchText}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => {
          setSearchText(e.target.value)
          setIsOpen(true)
        }}
      />
      {isOpen && (
        <ul className="searchable-select-list">
          {filtered.length > 0
            ? filtered.map((o) => (
                <li key={o.value} onMouseDown={() => selectOption(o)}>{o.label}</li>
              ))
            : <li className="searchable-select-empty">No matches</li>}
        </ul>
      )}
    </div>
  )
}
