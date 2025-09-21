// Mobile Navigation Toggle
document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    hamburger.addEventListener('click', function() {
        hamburger.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    // Close mobile menu when clicking on a link
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });

    // Active navigation highlighting
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-links a');
    
    navItems.forEach(item => {
        const itemPath = item.getAttribute('href');
        if (currentPath.includes(itemPath) && itemPath !== 'index.html') {
            item.classList.add('active');
        } else if (currentPath.endsWith('/') || currentPath.endsWith('index.html')) {
            if (itemPath === 'index.html') {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        } else {
            item.classList.remove('active');
        }
    });

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add scroll effect to header
    window.addEventListener('scroll', function() {
        const header = document.querySelector('header');
        if (window.scrollY > 100) {
            header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2)';
        } else {
            header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        }
    });
});

// Utility functions for other pages
function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength) + '...';
}

// Function to show notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Add notification styles
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        transform: translateX(120%);
        transition: transform 0.3s ease;
    }
    
    .notification.show {
        transform: translateX(0);
    }
    
    .notification.info {
        background-color: #0288d1;
    }
    
    .notification.success {
        background-color: #4caf50;
    }
    
    .notification.warning {
        background-color: #ff9800;
    }
    
    .notification.error {
        background-color: #f44336;
    }
`;
document.head.appendChild(notificationStyles);

// GitHub API functions to get star and fork counts
async function getGitHubRepoStats(repoName) {
    try {
        const response = await fetch(`https://api.github.com/repos/${repoName}`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        const data = await response.json();
        return {
            stars: data.stargazers_count,
            forks: data.forks_count
        };
    } catch (error) {
        console.error('Error fetching GitHub repo stats:', error);
        return { stars: 0, forks: 0 };
    }
}

// Function to update GitHub stats for all project cards
async function updateAllGitHubStats() {
    const statsElements = document.querySelectorAll('.github-stats');
    
    for (const element of statsElements) {
        const repoName = element.getAttribute('data-repo');
        if (repoName) {
            const stats = await getGitHubRepoStats(repoName);
            
            const starsElement = element.querySelector('.stars .count');
            const forksElement = element.querySelector('.forks .count');
            
            if (starsElement) {
                starsElement.textContent = stats.stars.toLocaleString();
            }
            if (forksElement) {
                forksElement.textContent = stats.forks.toLocaleString();
            }
        }
    }
}

// Update GitHub stats when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Update GitHub stats
    updateAllGitHubStats();
});