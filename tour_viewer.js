// tour-viewer.js - Vertical slideshow system for guided tours
class TourViewer {
  constructor(hub) {
    this.hub = hub;
    this.currentTours = [];
    this.activeTour = null;
    this.currentSlideIndex = 0;
    this.slides = [];

    // Bind the handleKeydown method to the instance
    this.handleKeydown = this.handleKeydown.bind(this);
    this._keydownAttached = false;
  }

  async loadTourData(worldId) {
    try {
      const tours = await this.hub.loadTours(worldId);
      this.currentTours = tours;
      
      Config.log(`Loaded ${tours.length} tours for world ${worldId}`);
      return tours;
    } catch (error) {
      Config.error('Failed to load tour data:', error);
      return [];
    }
  }

  // New method for unified explore mode - returns just tour content without header/toggle
  async renderTourContentOnly(worldId) {
    await this.loadTourData(worldId);

    if (this.currentTours.length === 0) {
      return this.renderEmptyState();
    }

    // Group tours by category for better organization
    const toursByCategory = this.groupToursByCategory();

    // Return just the tour categories, no header or toggle
    return this.renderTourCategories(toursByCategory);
  }

  // Legacy method for backward compatibility (kept but not used in unified mode)
  async renderTourSelection(worldId) {
    await this.loadTourData(worldId);

    if (this.currentTours.length === 0) {
      return this.renderEmptyState();
    }

    // Group tours by category for better organization
    const toursByCategory = this.groupToursByCategory();

    return `
      <div class="tour-selection">
        <div class="tour-header">
          <h3>Choose Your Experience</h3>
          <p>Select a guided tour or search the database directly</p>
        </div>
        
        <div class="tour-mode-selector">
          <button class="tour-mode-btn active" data-mode="tours">
            🗺️ Take a Tour
          </button>
          <button class="tour-mode-btn" data-mode="database">
            🔍 Search Database
          </button>
        </div>

        <div class="tour-content" id="tourContent">
          ${this.renderTourCategories(toursByCategory)}
        </div>
      </div>
    `;
  }

  groupToursByCategory() {
    const grouped = {};
    
    this.currentTours.forEach(tour => {
      const category = tour.category || 'General';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(tour);
    });

    return grouped;
  }

  renderTourCategories(toursByCategory) {
    const categories = Object.keys(toursByCategory);
    
    if (categories.length === 0) {
      return '<div class="no-tours">No tours available for this world</div>';
    }

    return `
      <div class="tour-categories">
        ${categories.map(category => {
          const tours = toursByCategory[category];
          const tourCards = tours.map(tour => this.renderTourCard(tour)).join('');
          
          return `
            <div class="tour-category">
              <h4 class="category-title">${category}</h4>
              <div class="tour-cards">
                ${tourCards}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  renderTourCard(tour) {
    const hasImage = tour.preview_image && tour.preview_image.trim();
    const backgroundImage = hasImage ? 
      `<img src="${tour.preview_image}" class="tour-card-bg" alt="${tour.title}" loading="lazy">` :
      `<div class="tour-card-bg-placeholder"></div>`;

    return `
      <div class="tour-card" data-tour-id="${tour.id}">
        ${backgroundImage}
        <div class="tour-card-overlay">
          <h5 class="tour-title">${tour.title}</h5>
          <p class="tour-description">${tour.description || 'Explore this guided experience'}</p>
          <!-- Removed: slide/time counter preview -->
          <!-- <div class="tour-meta">...</div> -->
        </div>
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="empty-state">
        <div class="empty-icon">🗺️</div>
        <h3>No Tours Available</h3>
        <p>This world doesn't have any tours set up yet.</p>
        <p>Switch to Database mode to browse articles instead.</p>
      </div>
    `;
  }

  async startTour(tourId) {
    try {
        // Show only overlay + tiny loading box (no modal yet)
        this.showTourLoadingOverlay();

        // Load slides in background
        this.slides = await this.hub.loadTourSlides(tourId);
        this.activeTour = this.currentTours.find(t => t.id === tourId);
        this.currentSlideIndex = 0;

        if (this.slides.length === 0) {
            throw new Error('No slides found for this tour');
        }

        // Now populate and show the modal (with fade-in)
        this.populateModal();
        
        Config.log(`Tour loaded: ${this.activeTour.title} with ${this.slides.length} slides`);
    } catch (error) {
        Config.error('Failed to start tour:', error);
        this.closeTourModal();
        alert('Could not load this tour. Please try again.');
    }
  }

  // Show overlay + centered loading box, keep modal hidden
  showTourLoadingOverlay() {
    const overlay = document.getElementById('tourModalOverlay');
    const modal = document.getElementById('tourModal');
    const loadingBox = document.getElementById('tourLoadingBox');

    if (!overlay || !loadingBox) {
      Config.error('Tour loading overlay elements not found in DOM');
      return;
    }

    // Show dimmed background
    overlay.classList.add('show');
    document.body.classList.add('modal-active');

    // Show small loading box
    loadingBox.style.display = 'block';

    // Ensure main modal is hidden while loading (no grey panel, no nav)
    if (modal) {
      modal.classList.remove('show');
    }
  }

  // Simplified: used when we explicitly want to show an already-populated modal
  openTourModal() {
    const tourModal = document.getElementById('tourModal');
    const tourModalOverlay = document.getElementById('tourModalOverlay');

    if (!tourModal || !tourModalOverlay) {
        Config.error('Tour modal template not found in DOM');
        return;
    }

    tourModalOverlay.classList.add('show');
    tourModal.classList.add('show');
    document.body.classList.add('modal-active');

    this.setupTourModalListeners();
  }

  populateModal() {
    const tourSlideContainer = document.getElementById('tourSlideContainer');
    const loadingBox = document.getElementById('tourLoadingBox');
    const tourModal = document.getElementById('tourModal');
    const tourModalOverlay = document.getElementById('tourModalOverlay');

    if (tourSlideContainer) {
        tourSlideContainer.innerHTML = this.renderAllModalSlides();
    }

    // Update progress and navigation
    this.updateTourModalProgress();
    this.updateTourModalNavigation();
    
    // Hide loading box
    if (loadingBox) loadingBox.style.display = 'none';

    // Fade in the modal now that content is ready
    if (tourModalOverlay) tourModalOverlay.classList.add('show');
    if (tourModal) tourModal.classList.add('show');

    // Setup event listeners now that content is loaded
    this.setupTourModalListeners();
  }

  closeTourModal() {
    const tourModal = document.getElementById('tourModal');
    const tourModalOverlay = document.getElementById('tourModalOverlay');
    const loadingBox = document.getElementById('tourLoadingBox');
    
    if (tourModal && tourModalOverlay) {
        tourModal.classList.remove('show');
        tourModalOverlay.classList.remove('show');
        document.body.classList.remove('modal-active');
    }
    if (loadingBox) {
        loadingBox.style.display = 'none';
    }

    // Clean up event listeners
    const closeBtn = document.getElementById('closeTourModalBtn');
    if (closeBtn) {
        closeBtn.removeEventListener('click', () => this.closeTourModal());
    }
    
    // Remove keyboard event listener
    if (this._keydownAttached) {
      document.removeEventListener('keydown', this.handleKeydown);
      this._keydownAttached = false;
    }

    // Reset tour state
    this.activeTour = null;
    this.slides = [];
    this.currentSlideIndex = 0;
    
    // Clear slide container
    const slideContainer = document.getElementById('tourSlideContainer');
    if (slideContainer) {
        slideContainer.innerHTML = '';
    }

    Config.log('Tour modal closed');
  }

  renderAllModalSlides() {
    return this.slides.map((slide, index) => 
      this.renderModalSlide(slide, index)
    ).join('');
  }

  renderModalSlide(slide, index) {
    const isActive = index === this.currentSlideIndex;
    const slideTypeClass = `slide-type-${slide.slide_type || 'default'}`;
    
    return `
        <div class="tour-modal-slide ${slideTypeClass} ${isActive ? 'active' : ''}" 
             data-slide-index="${index}"
             id="tour-slide-${index}">
            <div class="slide-media">
                ${this.renderSlideMedia(slide)}
            </div>
            <div class="slide-content">
                <h2 class="slide-title">${slide.title || 'Untitled'}</h2>
                <div class="slide-body">
                    ${this.markdownToHtml(slide.content || 'No content available')}
                </div>
            </div>
        </div>
    `;
  }

  renderSlideMedia(slide) {
    const mediaUrl = slide.media_url;
    if (!mediaUrl) {
      return '<div class="slide-media-placeholder">No media available</div>';
    }
    
    const isVideo = mediaUrl.match(/\.(mp4|webm|ogg)$/i);
    
    if (isVideo) {
        return `
            <video autoplay muted loop playsinline>
                <source src="${mediaUrl}" type="video/mp4">
            </video>
        `;
    } else {
        return `<img src="${mediaUrl}" alt="${slide.title}" loading="lazy">`;
    }
  }

  // Markdown conversion utility
  markdownToHtml(markdown) {
    if (!markdown) return 'No content available';
    
    return markdown
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.*)/, '<p>$1</p>');
  }

  setupTourModalListeners() {
    // Close button
    const closeBtn = document.getElementById('closeTourModalBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeTourModal());
    }

    // Navigation buttons
    const prevBtn = document.getElementById('tourModalPrevBtn');
    const nextBtn = document.getElementById('tourModalNextBtn');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.previousSlide());
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextSlide());
    }

    // Progress dots
    document.querySelectorAll('#tourModalDots .tour-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        const slideIndex = parseInt(e.target.dataset.slide);
        this.goToSlide(slideIndex);
      });
    });

    // Modal background click
    const tourModalOverlay = document.getElementById('tourModalOverlay');
    if (tourModalOverlay) {
      tourModalOverlay.addEventListener('click', () => this.closeTourModal());
    }

    // Prevent closing when clicking modal content
    const tourModal = document.getElementById('tourModal');
    if (tourModal) {
      tourModal.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Keyboard navigation with bound handler - only attach once
    if (!this._keydownAttached) {
      document.addEventListener('keydown', this.handleKeydown);
      this._keydownAttached = true;
    }
  }

  handleKeydown(e) {
    if (this.activeTour && document.body.classList.contains('modal-active')) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (this.currentSlideIndex > 0) {
                this.goToSlide(this.currentSlideIndex - 1);
            }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (this.currentSlideIndex < this.slides.length - 1) {
                this.goToSlide(this.currentSlideIndex + 1);
            }
        } else if (e.key === 'Escape') {
            this.closeTourModal();
        }
    }
  }

  nextSlide() {
    const nextIndex = this.currentSlideIndex + 1;
    if (nextIndex < this.slides.length) {
        this.goToSlide(nextIndex);
    }
  }

  previousSlide() {
    const prevIndex = this.currentSlideIndex - 1;
    if (prevIndex >= 0) {
        this.goToSlide(prevIndex);
    }
  }

  goToSlide(index) {
    if (index >= 0 && index < this.slides.length) {
      this.currentSlideIndex = index;
      this.updateTourModalDisplay();
    }
  }

  updateTourModalDisplay() {
    // Update active slide
    document.querySelectorAll('.tour-modal-slide').forEach((slide, index) => {
      slide.classList.toggle('active', index === this.currentSlideIndex);
    });

    // Update progress and navigation
    this.updateTourModalProgress();
    this.updateTourModalNavigation();
  }

  updateTourModalProgress() {
    const progressEl = document.getElementById('tourModalProgress');
    if (progressEl) {
      progressEl.textContent = `Slide ${this.currentSlideIndex + 1} of ${this.slides.length}`;
    }
  }

  updateTourModalNavigation() {
    // Update navigation buttons
    const prevBtn = document.getElementById('tourModalPrevBtn');
    const nextBtn = document.getElementById('tourModalNextBtn');
    
    if (prevBtn) prevBtn.disabled = this.currentSlideIndex === 0;
    if (nextBtn) nextBtn.disabled = this.currentSlideIndex === this.slides.length - 1;

    // Update progress dots
    const dotsContainer = document.getElementById('tourModalDots');
    if (dotsContainer) {
      dotsContainer.innerHTML = this.slides.map((_, index) => 
        `<button class="tour-dot ${index === this.currentSlideIndex ? 'active' : ''}" 
                data-slide="${index}"></button>`
      ).join('');

      // Re-attach dot listeners
      dotsContainer.querySelectorAll('.tour-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          const slideIndex = parseInt(e.target.dataset.slide);
          this.goToSlide(slideIndex);
        });
      });
    }
  }

  // Legacy slideshow methods kept for backward compatibility
  renderTourSlideshow() {
    const hubContent = document.getElementById('hubContent');
    if (!hubContent) return;

    hubContent.innerHTML = `
      <div class="tour-slideshow">
        <div class="tour-header-bar">
          <button class="tour-back-btn" onclick="window.tourViewer.exitTour()">
            ← Back to Tours
          </button>
          <div class="tour-info">
            <span class="tour-title">${this.activeTour.title}</span>
            <span class="tour-progress">${this.currentSlideIndex + 1} / ${this.slides.length}</span>
          </div>
        </div>

        <div class="tour-slides-container" id="tourSlidesContainer">
          ${this.renderAllSlides()}
        </div>

        <div class="tour-navigation">
          <button class="tour-nav-btn" id="prevSlide" ${this.currentSlideIndex === 0 ? 'disabled' : ''}>
            ← Previous
          </button>
          <div class="tour-dots">
            ${this.renderProgressDots()}
          </div>
          <button class="tour-nav-btn" id="nextSlide" ${this.currentSlideIndex === this.slides.length - 1 ? 'disabled' : ''}>
            Next →
          </button>
        </div>
      </div>
    `;

    this.setupTourEventListeners();
    this.scrollToCurrentSlide();
  }

  renderAllSlides() {
    return this.slides.map((slide, index) => 
      this.renderSlide(slide, index)
    ).join('');
  }

  renderSlide(slide, index) {
    const isActive = index === this.currentSlideIndex;
    const slideTypeClass = `slide-type-${slide.slide_type || 'default'}`;
    
    const content = this.renderSlideContent(slide);
    
    return `
      <div class="tour-slide ${slideTypeClass} ${isActive ? 'active' : ''}" 
           data-slide-index="${index}"
           id="slide-${index}">
        ${content}
      </div>
    `;
  }

  renderProgressDots() {
    return this.slides.map((_, index) => 
      `<button class="tour-dot ${index === this.currentSlideIndex ? 'active' : ''}" 
              data-slide="${index}"></button>`
    ).join('');
  }

  setupTourEventListeners() {
    // Navigation buttons
    const prevBtn = document.getElementById('prevSlide');
    const nextBtn = document.getElementById('nextSlide');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.previousSlide());
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextSlide());
    }

    // Progress dots
    document.querySelectorAll('.tour-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        const slideIndex = parseInt(e.target.dataset.slide);
        this.goToSlide(slideIndex);
      });
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (this.activeTour) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          this.previousSlide();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.nextSlide();
        } else if (e.key === 'Escape') {
          this.exitTour();
        }
      }
    });
  }

  updateSlideDisplay() {
    // Update active slide
    document.querySelectorAll('.tour-slide').forEach((slide, index) => {
      slide.classList.toggle('active', index === this.currentSlideIndex);
    });

    // Update progress dots
    document.querySelectorAll('.tour-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index === this.currentSlideIndex);
    });

    // Update navigation buttons
    const prevBtn = document.getElementById('prevSlide');
    const nextBtn = document.getElementById('nextSlide');
    const progress = document.querySelector('.tour-progress');
    
    if (prevBtn) prevBtn.disabled = this.currentSlideIndex === 0;
    if (nextBtn) nextBtn.disabled = this.currentSlideIndex === this.slides.length - 1;
    if (progress) progress.textContent = `${this.currentSlideIndex + 1} / ${this.slides.length}`;
  }

  scrollToCurrentSlide() {
    const currentSlide = document.getElementById(`slide-${this.currentSlideIndex}`);
    if (currentSlide) {
      currentSlide.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
    }
  }

  exitTour() {
    this.activeTour = null;
    this.slides = [];
    this.currentSlideIndex = 0;
    
    document.body.style.overflow = '';

    this.hub.currentMode = 'explore';
    this.hub.currentExploreSubmode = 'tours';
    this.hub.showWorldHub();
  }

  // Setup tour card listeners - used by unified explore mode
  setupTourCardListeners() {
    document.querySelectorAll('.tour-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const tourId = e.currentTarget.dataset.tourId;
        this.startTour(tourId);
      });
    });
  }

  // Simplified event listener setup - only handles tour cards
  setupEventListeners() {
    this.setupTourCardListeners();
  }
}

// Export for use in main hub
window.TourViewer = TourViewer;