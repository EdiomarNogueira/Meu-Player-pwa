import React, { useEffect, useState } from 'react';
import { Download, FolderPlus, HardDrive, Search, Settings, Sparkles, WifiOff, X } from 'lucide-react';
import { BrowseSection, IptvSource } from '../types/iptv';

interface NavbarProps {
  section: BrowseSection;
  onSelectSection: (sec: BrowseSection) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sources: IptvSource[];
  activeSourceId: string | null;
  onSelectSource: (id: string) => void;
  isOnline: boolean;
  canInstall: boolean;
  isStandalone: boolean;
  enrichProgress: { done: number; total: number } | null;
  onInstallClick: () => void;
  onOpenSourcesModal: () => void;
  onOpenSettingsModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  section,
  onSelectSection,
  searchQuery,
  onSearchChange,
  sources,
  activeSourceId,
  onSelectSource,
  isOnline,
  canInstall,
  isStandalone,
  enrichProgress,
  onInstallClick,
  onOpenSourcesModal,
  onOpenSettingsModal,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const isLocalMode = section === 'local';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={'top-navbar ' + (scrolled || isLocalMode ? 'scrolled ' : '') + (isLocalMode ? 'studio-navbar' : '')}>
      <div className="nav-left">
        <button type="button" className="brand-mark" onClick={() => onSelectSection('home')}>
          <span className={isLocalMode ? 'brand-cyan' : 'brand-red'}>MEUPLAYER</span>
          <span className="brand-light">{isLocalMode ? 'STUDIO' : 'TV'}</span>
          {isStandalone && <span className="pwa-tag">APP</span>}
        </button>

        <nav className="primary-links">
          <button type="button" className={'nav-link ' + (section === 'home' ? 'active' : '')} onClick={() => onSelectSection('home')}>Início</button>
          <button type="button" className={'nav-link ' + (section === 'live' ? 'active' : '')} onClick={() => onSelectSection('live')}>TV ao Vivo</button>
          <button type="button" className={'nav-link ' + (section === 'movies' ? 'active' : '')} onClick={() => onSelectSection('movies')}>Filmes e Séries</button>
          <button type="button" className={'nav-link ' + (section === 'mylist' ? 'active' : '')} onClick={() => onSelectSection('mylist')}>Minha Lista</button>
          <button type="button" className={'nav-link local-tab-pill ' + (isLocalMode ? 'active' : '')} onClick={() => onSelectSection('local')}>
            <HardDrive size={15} />
            <span>Estúdio Local (PC)</span>
          </button>
        </nav>
      </div>

      <div className="nav-right">
        {!isLocalMode && enrichProgress && enrichProgress.done < enrichProgress.total && (
          <div className="enrich-pill">
            <Sparkles size={13} className="pulse-icon" />
            <span>Capas {enrichProgress.done}/{enrichProgress.total}</span>
          </div>
        )}

        {!isOnline && (
          <div className="offline-chip">
            <WifiOff size={14} />
            <span>Offline</span>
          </div>
        )}

        <div className="search-box">
          <Search size={15} className="search-box-icon" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={isLocalMode ? 'Filtrar arquivos ou pastas...' : 'Títulos, canais ou gêneros...'}
          />
          {searchQuery && (
            <button type="button" className="clear-search-btn" onClick={() => onSearchChange('')}>
              <X size={14} />
            </button>
          )}
        </div>

        {!isLocalMode && sources.length > 1 && (
          <select className="source-switcher" value={activeSourceId ?? ''} onChange={(e) => onSelectSource(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.channelCount})</option>
            ))}
          </select>
        )}

        {canInstall && (
          <button type="button" className="btn-glass" onClick={onInstallClick}>
            <Download size={15} />
            <span>Instalar</span>
          </button>
        )}

        {!isLocalMode && (
          <button type="button" className="btn-crimson" onClick={onOpenSourcesModal}>
            <FolderPlus size={15} />
            <span>Fontes IPTV</span>
          </button>
        )}

        <button type="button" className="btn-circle" onClick={onOpenSettingsModal} aria-label="Configurações">
          <Settings size={17} />
        </button>
      </div>
    </header>
  );
};
