import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Merchant } from "../lib/types";

interface Props {
  value: string;
  onChange: (name: string, merchant: Merchant | null) => void;
}

export function MerchantAutocomplete({ value, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<Merchant[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const results = await api.get<Merchant[]>(
        `/api/merchants?search=${encodeURIComponent(trimmed)}&active=true`
      );
      setSuggestions(results);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const exactMatch = suggestions.find((m) => m.name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div className="autocomplete">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Start typing a merchant name…"
        autoComplete="off"
        required
      />
      {open && suggestions.length > 0 && (
        <ul className="autocomplete-list">
          {suggestions.map((merchant) => (
            <li
              key={merchant.id}
              onMouseDown={() => {
                onChange(merchant.name, merchant);
                setOpen(false);
              }}
            >
              {merchant.name}
              <span className="autocomplete-code">{merchant.merchantCode}</span>
            </li>
          ))}
        </ul>
      )}
      {value.trim().length > 0 && !exactMatch && (
        <p className="hint">This will create a new merchant: “{value.trim()}”</p>
      )}
    </div>
  );
}
