class PanelCalculator {
    constructor() {
        this.MAX_PANEL_WIDTH = 1150; // mm
        this.MIN_SIDE_PANEL = 200; // mm
        this.leftovers = []; // Array to store leftover panels
        this.panelAnalysis = {
            totalFullPanels: 0,
            totalCutPanels: 0,
            totalLeftoverPanels: 0,
            totalPanels: 0,
            totalWaste: 0,
            optimizationScore: 0,
            fullPanelsUsedForCutting: 0
        };
        
        // Common wall lengths that might appear frequently
        this.commonLengths = [
            2400, // Standard room width
            3000, // Common room length
            3600, // Large room dimension
            4200, // Extra large room dimension
            4800  // Maximum standard room dimension
        ];
    }

    // Enhanced panel calculation with 45-degree cut handling
    calculatePanels(wallLength, wallThickness, jointType) {
        const panels = [];
        let remainingLength = wallLength;
        
        // Calculate full panels needed
        const fullPanelsCount = Math.floor(remainingLength / this.MAX_PANEL_WIDTH);
        for (let i = 0; i < fullPanelsCount; i++) {
            panels.push(this.createFullPanel(jointType));
            remainingLength -= this.MAX_PANEL_WIDTH;
        }

        // Handle remaining length
        if (remainingLength > 0) {
            if (remainingLength < this.MIN_SIDE_PANEL) {
                // If remaining length is small, use it as one piece
                const sidePanel = this.createSidePanelWithCut(remainingLength, wallThickness, jointType);
                panels.push(sidePanel);
            } else {
                // Split remaining length evenly
                const halfLength = Math.floor(remainingLength / 2);
                const firstSidePanel = this.createSidePanelWithCut(halfLength, wallThickness, jointType);
                const secondSidePanel = this.createSidePanelWithCut(remainingLength - halfLength, wallThickness, jointType);
                panels.push(firstSidePanel, secondSidePanel);
            }
        }

        return panels;
    }

    createSidePanelWithCut(width, wallThickness, jointType) {
        this.panelAnalysis.totalCutPanels++;
        this.panelAnalysis.totalPanels++;

        // Find compatible leftover panel
        const compatibleLeftover = this.findCompatibleLeftover(width, wallThickness, jointType);
        
        if (compatibleLeftover) {
            // Use existing leftover panel
            const panel = this.createPanelFromLeftover(compatibleLeftover, width, jointType);
            this.updateLeftoverAfterCut(compatibleLeftover, width, wallThickness, jointType);
            return panel;
        } else {
            // Create new panel and make cut
            this.panelAnalysis.fullPanelsUsedForCutting++;
            const panel = this.createSidePanel(width, 'right', jointType);
            
            // Create new leftover
            const leftover = {
                id: Date.now(),
                shorter_face: this.MAX_PANEL_WIDTH - width,
                longer_face: jointType === '45_cut' ? 
                    this.MAX_PANEL_WIDTH - width + wallThickness : 
                    this.MAX_PANEL_WIDTH - width,
                wallThickness: wallThickness,
                has45DegreeEdge: jointType === '45_cut',
                created: Date.now()
            };
            this.leftovers.push(leftover);
            
            return panel;
        }
    }

    findCompatibleLeftover(neededWidth, wallThickness, jointType) {
        return this.leftovers.find(leftover => {
            // Check if thickness matches
            if (leftover.wallThickness !== wallThickness) return false;

            // For 45-degree cut, use longer face
            // For butt-in joint, use shorter face
            const availableLength = jointType === '45_cut' ? 
                leftover.longer_face : 
                leftover.shorter_face;

            return availableLength >= neededWidth;
        });
    }

    updateLeftoverAfterCut(leftover, cutWidth, wallThickness, jointType) {
        if (jointType === '45_cut') {
            // For 45-degree cut, deduct from longer face
            leftover.longer_face -= cutWidth;
            // If we've used the 45-degree edge, update the leftover
            if (leftover.has45DegreeEdge) {
                leftover.has45DegreeEdge = false;
                // Update shorter face to match new longer face
                leftover.shorter_face = leftover.longer_face - wallThickness;
            }
        } else {
            // For butt-in joint, deduct from shorter face
            leftover.shorter_face -= cutWidth;
            // If the leftover had a 45-degree edge, update it
            if (leftover.has45DegreeEdge) {
                leftover.longer_face = leftover.shorter_face + wallThickness;
            }
        }
        
        // Keep all leftovers regardless of size
        // They might be useful in other places
    }

    // Calculate efficiency score for a leftover panel
    calculateEfficiencyScore(leftover) {
        const usableLength = Math.min(
            this.MAX_PANEL_WIDTH,
            leftover.jointType === '45_cut' ? leftover.longer_side : leftover.shorter_side
        );
        const wasteRatio = 1 - (usableLength / this.MAX_PANEL_WIDTH);
        const ageFactor = 1 - (Date.now() - leftover.created) / (30 * 24 * 60 * 60 * 1000); // 30 days
        return (1 - wasteRatio) * 0.7 + ageFactor * 0.3;
    }

    // Find best-fit leftover panel
    findBestFitLeftover(neededLength, jointType) {
        return this.leftovers.find(leftover => {
            // For 45-degree cut, use the longer face
            // For butt-in joint, use the shorter face
            const suitableLength = jointType === '45_cut' ? 
                Math.min(leftover.longer_side, this.MAX_PANEL_WIDTH) :
                Math.min(leftover.shorter_side, this.MAX_PANEL_WIDTH);

            // Consider both exact fit and near-fit with waste threshold
            return suitableLength >= neededLength || 
                   (suitableLength >= this.MIN_SIDE_PANEL && 
                    suitableLength >= neededLength * 0.8 &&
                    (suitableLength - neededLength) <= this.MAX_PANEL_WIDTH * 0.2);
        });
    }

    // Calculate optimal cut for a leftover panel
    calculateOptimalCut(leftover, neededLength, jointType) {
        if (jointType === '45_cut') {
            // For 45-degree cut
            const longerFace = leftover.longer_side - neededLength + 100; // wall thickness
            const shorterFace = leftover.longer_side - neededLength;
            return {
                cutLength: neededLength,
                longerFace: longerFace,
                shorterFace: shorterFace,
                is45Degree: true
            };
        } else {
            // For straight cut (butt-in)
            const straightLength = leftover.shorter_side - neededLength;
            return {
                cutLength: neededLength,
                longerFace: straightLength,
                shorterFace: straightLength,
                is45Degree: false
            };
        }
    }

    // Optimize the number of full panels to minimize waste
    optimizeFullPanelCount(remainingLength, initialCount) {
        const wasteWithFullPanels = remainingLength - (initialCount * this.MAX_PANEL_WIDTH);
        const wasteWithOneLess = (initialCount - 1) * this.MAX_PANEL_WIDTH - remainingLength;
        
        // If using one less full panel would result in less waste, adjust the count
        if (wasteWithOneLess < wasteWithFullPanels && wasteWithOneLess >= this.MIN_SIDE_PANEL) {
            return initialCount - 1;
        }
        
        return initialCount;
    }

    // Optimize remaining length handling
    optimizeRemainingLength(remainingLength, wallThickness, jointType) {
        const panels = [];
        
        // If remaining length is large enough, consider splitting it optimally
        if (remainingLength >= this.MIN_SIDE_PANEL * 2) {
            const optimalSplit = this.calculateOptimalSplit(remainingLength);
            panels.push(
                this.createSidePanel(optimalSplit.first, 'left', jointType),
                this.createSidePanel(optimalSplit.second, 'right', jointType)
            );
        } else if (remainingLength >= this.MIN_SIDE_PANEL) {
            // Use as single panel if it meets minimum size
            panels.push(this.createSidePanel(remainingLength, 'right', jointType));
        } else {
            // Handle small remaining length
            this.handleSmallRemainingLength(remainingLength, panels, jointType);
        }

        return panels;
    }

    // Calculate optimal split for remaining length
    calculateOptimalSplit(remainingLength) {
        // Try to split in a way that creates useful leftover pieces
        const halfLength = Math.floor(remainingLength / 2);
        const firstHalf = Math.ceil(halfLength / 50) * 50; // Round to nearest 50mm
        return {
            first: firstHalf,
            second: remainingLength - firstHalf
        };
    }

    // Handle small remaining length
    handleSmallRemainingLength(remainingLength, panels, jointType) {
        if (panels.length > 0) {
            const lastPanel = panels[panels.length - 1];
            const newWidth = lastPanel.width + remainingLength;
            
            if (newWidth <= this.MAX_PANEL_WIDTH) {
                lastPanel.width = newWidth;
            } else {
                // Create a new panel if adding would exceed max width
                panels.push(this.createSidePanel(remainingLength, 'right', jointType));
            }
        } else {
            // If no panels yet, create a panel with exact remaining length
            panels.push(this.createSidePanel(remainingLength, 'right', jointType));
        }
    }

    // Calculate optimization metrics
    calculateOptimizationMetrics(panels, originalLength) {
        const totalWidth = panels.reduce((sum, panel) => sum + panel.width, 0);
        const waste = totalWidth - originalLength;
        
        this.panelAnalysis.totalWaste = waste;
        this.panelAnalysis.optimizationScore = this.calculateOptimizationScore(panels, waste);
    }

    // Calculate overall optimization score
    calculateOptimizationScore(panels, waste) {
        const fullPanelRatio = panels.filter(p => p.type === 'full').length / panels.length;
        const leftoverUsageRatio = panels.filter(p => p.type === 'leftover').length / panels.length;
        const wasteRatio = waste / (panels.length * this.MAX_PANEL_WIDTH);
        
        return (fullPanelRatio * 0.4 + leftoverUsageRatio * 0.4 + (1 - wasteRatio) * 0.2) * 100;
    }

    // Find pattern match for common wall lengths
    findPatternMatch(length) {
        return this.commonLengths.find(commonLength => 
            Math.abs(length - commonLength) < 50 // Allow 50mm tolerance
        );
    }

    // Apply pattern-based panel calculation
    applyPattern(patternLength, wallThickness, jointType) {
        const panels = [];
        const fullPanelsCount = Math.floor(patternLength / this.MAX_PANEL_WIDTH);
        let remainingLength = patternLength;

        // Add full panels
        for (let i = 0; i < fullPanelsCount; i++) {
            panels.push(this.createFullPanel(jointType));
            remainingLength -= this.MAX_PANEL_WIDTH;
        }

        // Handle remaining length based on pattern
        if (remainingLength > 0) {
            if (remainingLength >= this.MIN_SIDE_PANEL * 2) {
                const halfLength = Math.floor(remainingLength / 2);
                panels.push(
                    this.createSidePanel(halfLength, 'left', jointType),
                    this.createSidePanel(remainingLength - halfLength, 'right', jointType)
                );
            } else {
                panels.push(this.createSidePanel(remainingLength, 'right', jointType));
            }
        }

        return panels;
    }

    // Helper methods for creating different types of panels
    createFullPanel(jointType) {
        this.panelAnalysis.totalFullPanels++;
        this.panelAnalysis.totalPanels++;
        return {
            width: this.MAX_PANEL_WIDTH,
            isFullPanel: true,
            jointType: jointType,
            type: 'full'
        };
    }

    createSidePanel(width, position, jointType) {
        this.panelAnalysis.totalCutPanels++;
        this.panelAnalysis.totalPanels++;
        return {
            width: width,
            isSidePanel: true,
            position: position,
            jointType: jointType,
            type: 'side'
        };
    }

    createPanelFromLeftover(leftover, width, jointType) {
        this.panelAnalysis.totalLeftoverPanels++;
        this.panelAnalysis.totalPanels++;
        return {
            width: width,
            isLeftover: true,
            leftoverId: leftover.id,
            jointType: jointType,
            type: 'side'
        };
    }

    // Reset panel analysis
    resetPanelAnalysis() {
        this.panelAnalysis = {
            totalFullPanels: 0,
            totalCutPanels: 0,
            totalLeftoverPanels: 0,
            totalPanels: 0,
            totalWaste: 0,
            optimizationScore: 0,
            fullPanelsUsedForCutting: 0
        };
    }

    // Calculate total material used
    calculateMaterialUsage(panels) {
        return panels.reduce((total, panel) => total + panel.width, 0);
    }

    // Get panel visualization data
    getPanelVisualization(panels, wallStart, wallEnd) {
        let currentPosition = 0;
        return panels.map(panel => {
            const start = currentPosition;
            currentPosition += panel.width;
            return {
                ...panel,
                start: start,
                end: currentPosition,
                center: (start + currentPosition) / 2
            };
        });
    }

    // Get panel analysis
    getPanelAnalysis() {
        return {
            ...this.panelAnalysis,
            details: {
                fullPanels: this.panelAnalysis.totalFullPanels,
                cutPanels: this.panelAnalysis.totalCutPanels,
                leftoverPanels: this.leftovers.length,
                totalPanels: this.panelAnalysis.totalPanels,
                fullPanelsUsedForCutting: this.panelAnalysis.fullPanelsUsedForCutting
            }
        };
    }

    // Update leftovers after using a panel
    updateLeftovers(leftover, cut, jointType) {
        // Remove the used leftover
        this.removeLeftover(leftover.id);

        // Create new leftover based on cut type
        if (cut.is45Degree) {
            // For 45-degree cut, store both faces
            if (cut.longerFace >= this.MIN_SIDE_PANEL) {
                this.leftovers.push({
                    id: Date.now(),
                    longer_side: cut.longerFace,
                    shorter_side: cut.shorterFace,
                    jointType: jointType,
                    created: new Date()
                });
            }
        } else {
            // For straight cut, both faces are equal
            if (cut.longerFace >= this.MIN_SIDE_PANEL) {
                this.leftovers.push({
                    id: Date.now(),
                    longer_side: cut.longerFace,
                    shorter_side: cut.shorterFace,
                    jointType: 'straight',
                    created: new Date()
                });
            }
        }
    }

    // Remove used leftover
    removeLeftover(id) {
        this.leftovers = this.leftovers.filter(leftover => leftover.id !== id);
    }
}

export default PanelCalculator; 