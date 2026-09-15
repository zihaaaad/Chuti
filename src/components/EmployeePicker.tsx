'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useActiveLeaveTypes } from '@/context/LeaveTypesContext';

export interface PickerEmployee {
  id: number;
  name: string;
  employee_id: string;
  department?: string | null;
  cl_left?: number | null;
  /** Remaining days per leave type code, for the quick balance hint. */
  balances?: Record<string, number>;
}

/** How many balance badges fit beside a name before the row gets cramped. */
const MAX_BALANCE_BADGES = 3;

interface Props {
  id: string;
  employees: PickerEmployee[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  showBalances?: boolean;
  placeholder?: string;
}

const MAX_RESULTS = 50;

/**
 * Type-ahead employee picker (ARIA combobox pattern). Searches name, ID and
 * department; a native <select> becomes unusable past a few dozen staff.
 */
export default function EmployeePicker({ id, employees, value, onChange, disabled, invalid, describedBy, showBalances = true, placeholder = 'Search by name or ID…' }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const balanceTypes = useActiveLeaveTypes().filter((t) => t.hasQuota).slice(0, MAX_BALANCE_BADGES);
  const selected = employees.find((e) => String(e.id) === value) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? employees.filter((e) => e.name.toLowerCase().includes(q) || e.employee_id.toLowerCase().includes(q) || (e.department ?? '').toLowerCase().includes(q))
      : employees;
    return list.slice(0, MAX_RESULTS);
  }, [employees, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (emp: PickerEmployee) => {
    onChange(String(emp.id));
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  };

  const displayValue = open ? query : selected ? `${selected.name} (${selected.employee_id})` : '';

  return (
    <div className="combobox" ref={wrapRef}>
      <div className="input-with-icon">
        <Search size={16} aria-hidden />
        <input
          ref={inputRef}
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          placeholder={selected ? `${selected.name} (${selected.employee_id})` : placeholder}
          value={displayValue}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setActive(Math.max(0, results.findIndex((r) => String(r.id) === value)));
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          style={{ paddingRight: '2rem' }}
        />
        <ChevronDown size={16} aria-hidden style={{ left: 'auto', right: '0.65rem' }} />
      </div>
      {open && !disabled && (
        <ul className="combobox-list" id={listId} role="listbox">
          {results.length === 0 && <li className="combobox-empty">No active employee matches “{query}”.</li>}
          {results.map((emp, i) => (
            <li
              key={emp.id}
              id={`${listId}-${emp.id}`}
              role="option"
              aria-selected={String(emp.id) === value}
              data-active={i === active}
              className="combobox-option"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(emp);
              }}
            >
              <span>
                <strong>{emp.name}</strong> <span className="subtle">{emp.employee_id}{emp.department ? ` · ${emp.department}` : ''}</span>
              </span>
              {showBalances && emp.balances && (
                <span className="meta num">
                  {balanceTypes.map((t) => (
                    <span key={t.code} className={`badge tone-${t.tone}`} title={`${t.label} left`}>{t.short} {emp.balances?.[t.code] ?? 0}</span>
                  ))}
                </span>
              )}
            </li>
          ))}
          {employees.length > MAX_RESULTS && results.length === MAX_RESULTS && (
            <li className="combobox-empty">Showing the first {MAX_RESULTS}. Type to narrow down.</li>
          )}
        </ul>
      )}
    </div>
  );
}
