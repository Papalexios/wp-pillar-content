import React, { useMemo, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { WordPressPost } from '../types';

interface VirtualizedContentTableProps {
  posts: WordPressPost[];
  selectedPosts: Set<number>;
  onPostSelect: (postId: number) => void;
  onSelectAll: (checked: boolean) => void;
  onGenerateContent: (postIds: number[]) => void;
  searchTerm: string;
  statusFilter: string;
}

export const VirtualizedContentTable: React.FC<VirtualizedContentTableProps> = ({
  posts,
  selectedPosts,
  onPostSelect,
  onSelectAll,
  onGenerateContent,
  searchTerm,
  statusFilter
}) => {
  const [sortConfig, setSortConfig] = useState<{ key: keyof WordPressPost; direction: 'asc' | 'desc' } | null>(null);

  // Filter and sort posts
  const filteredAndSortedPosts = useMemo(() => {
    let filtered = posts.filter(post => {
      const matchesSearch = post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          post.slug.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || post.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    if (sortConfig) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [posts, searchTerm, statusFilter, sortConfig]);

  const handleSort = useCallback((key: keyof WordPressPost) => {
    setSortConfig(current => ({
      key,
      direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  }, []);

  // Parent ref for virtualization
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredAndSortedPosts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  const handleSelectAll = useCallback((checked: boolean) => {
    onSelectAll(checked);
  }, [onSelectAll]);

  const renderStatusCell = useCallback((status: string) => {
    return (
      <div className={`status status-${status}`}>
        <span className="status-dot"></span>
        {status}
      </div>
    );
  }, []);

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  }, []);

  const isAllSelected = filteredAndSortedPosts.length > 0 && 
                       filteredAndSortedPosts.every(post => selectedPosts.has(post.id));
  const isPartiallySelected = filteredAndSortedPosts.some(post => selectedPosts.has(post.id)) && 
                             !isAllSelected;

  return (
    <div className="table-wrapper">
      <div className="table-toolbar">
        <div className="toolbar-section">
          <label className="custom-checkbox-all">
            <input
              type="checkbox"
              checked={isAllSelected}
              ref={input => {
                if (input) input.indeterminate = isPartiallySelected;
              }}
              onChange={(e) => handleSelectAll(e.target.checked)}
            />
            <span className="checkmark"></span>
            Select All ({selectedPosts.size} selected)
          </label>
        </div>
        
        <div className="toolbar-section">
          {selectedPosts.size > 0 && (
            <button 
              className="btn btn-small"
              onClick={() => onGenerateContent(Array.from(selectedPosts))}
            >
              Generate Content ({selectedPosts.size})
            </button>
          )}
        </div>
      </div>

      {/* Virtualized Table Container */}
      <div
        ref={parentRef}
        style={{
          height: '600px',
          overflow: 'auto',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          backgroundColor: 'var(--surface-color)'
        }}
      >
        {/* Table Header - Fixed */}
        <div style={{ 
          position: 'sticky', 
          top: 0, 
          backgroundColor: 'var(--surface-color)',
          borderBottom: '2px solid var(--border-color)',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: '50px 1fr 120px 120px 100px 100px',
          gap: '1rem',
          padding: '1rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--text-light-color)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          <div></div>
          <div 
            className="sortable"
            onClick={() => handleSort('title')}
            style={{ cursor: 'pointer' }}
          >
            Title
            <span className={`sort-indicator ${sortConfig?.key === 'title' ? sortConfig.direction : ''}`}>
              ▼
            </span>
          </div>
          <div 
            className="sortable"
            onClick={() => handleSort('status')}
            style={{ cursor: 'pointer' }}
          >
            Status
            <span className={`sort-indicator ${sortConfig?.key === 'status' ? sortConfig.direction : ''}`}>
              ▼
            </span>
          </div>
          <div 
            className="sortable"
            onClick={() => handleSort('lastModified')}
            style={{ cursor: 'pointer' }}
          >
            Modified
            <span className={`sort-indicator ${sortConfig?.key === 'lastModified' ? sortConfig.direction : ''}`}>
              ▼
            </span>
          </div>
          <div 
            className="sortable"
            onClick={() => handleSort('wordCount')}
            style={{ cursor: 'pointer' }}
          >
            Words
            <span className={`sort-indicator ${sortConfig?.key === 'wordCount' ? sortConfig.direction : ''}`}>
              ▼
            </span>
          </div>
          <div>Actions</div>
        </div>

        {/* Virtualized Rows */}
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const post = filteredAndSortedPosts[virtualItem.index];
            const isSelected = selectedPosts.has(post.id);
            
            return (
              <div
                key={post.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 120px 120px 100px 100px',
                  gap: '1rem',
                  padding: '1rem 1.25rem',
                  alignItems: 'center',
                  backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                  borderBottom: '1px solid var(--border-color)',
                  transition: 'background-color 0.2s ease'
                }}
                className={`table-row ${isSelected ? 'selected' : ''}`}
              >
                <label className="custom-checkbox">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onPostSelect(post.id)}
                  />
                  <span className="checkmark"></span>
                </label>
                
                <div className="post-title-cell">
                  <a href={post.url} target="_blank" rel="noopener noreferrer">
                    {post.title}
                  </a>
                  {post.isStale && <span className="stale-badge">Stale</span>}
                </div>
                
                <div>{renderStatusCell(post.status)}</div>
                <div>{formatDate(post.lastModified)}</div>
                <div>{post.wordCount.toLocaleString()}</div>
                
                <div className="table-actions">
                  <button 
                    className="btn btn-small btn-secondary"
                    onClick={() => onGenerateContent([post.id])}
                    disabled={post.status === 'generating'}
                  >
                    {post.status === 'generating' ? 'Generating...' : 'Update'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};