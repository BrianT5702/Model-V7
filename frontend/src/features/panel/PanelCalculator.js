class PanelCalculator {
    constructor() {
        this.MAX_PANEL_WIDTH = 1150; // mm
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

    // Add new method to clean up leftover panels
    cleanupLeftovers() {
        this.leftovers = this.leftovers.filter(leftover => 
            leftover.longer_face > 0 && leftover.shorter_face > 0
        );
    }

    // Enhanced panel calculation with 45-degree cut handling and 20mm optimization
    calculatePanels(wallLength, wallThickness, jointType, wallHeight = 3000) {
        // console.log(`\n=== Starting calculation for wall length: ${wallLength}mm, thickness: ${wallThickness}mm ===`);
        // console.log(`Joint type:`, jointType);
        // console.log(`Wall height: ${wallHeight}mm`);
        
        const panels = [];
        let remainingLength = wallLength;
        
        // Determine threshold and minimum panel width based on wall height
        const threshold = wallHeight < 5000 ? 600 : 1000;
        const minPanelWidth = wallHeight < 5000 ? 300 : 500;
        // console.log(`Threshold for panel splitting: ${threshold}mm, Minimum panel width: ${minPanelWidth}mm (wall height: ${wallHeight}mm)`);

        // Calculate full panels needed
        const fullPanelsCount = Math.floor(remainingLength / this.MAX_PANEL_WIDTH);
        // console.log(`\nFull panels calculation:`);
        // console.log(`- Full panels needed: ${fullPanelsCount}`);
        
        for (let i = 0; i < fullPanelsCount; i++) {
            panels.push(this.createFullPanel(jointType));
            remainingLength -= this.MAX_PANEL_WIDTH;
        }
        // console.log(`- Remaining length after full panels: ${remainingLength}mm`);

        // Handle remaining length
        if (remainingLength > 0) {
            // console.log(`\nHandling remaining length: ${remainingLength}mm`);
            
            // Check if remaining length is too small for a minimum panel
            if (remainingLength < minPanelWidth) {
                if (fullPanelsCount > 0) {
                    // console.log(`- Remaining length (${remainingLength}mm) < minimum panel width (${minPanelWidth}mm)`);
                    // console.log(`- Adding remaining length to last full panel and splitting into two`);
                    
                    // Remove the last full panel
                    const lastFullPanel = panels.pop();
                    
                    // Calculate the total length to be split
                    // Use the actual width of the last panel (could be 1150mm or 1130mm if optimized)
                    const lastPanelActualWidth = lastFullPanel.actualWidth || lastFullPanel.width;
                    const totalLengthToSplit = lastPanelActualWidth + remainingLength;
                    const halfLength = Math.floor(totalLengthToSplit / 2);
                    
                    // console.log(`- Last panel actual width: ${lastPanelActualWidth}mm`);
                    // console.log(`- Total length to split: ${totalLengthToSplit}mm`);
                    // console.log(`- Split lengths: ${halfLength}mm and ${totalLengthToSplit - halfLength}mm`);
                    
                    // Create two side panels from the split length
                    if (typeof jointType === 'object') {
                        const firstSidePanel = this.createSidePanelWithCut(
                            halfLength, 
                            wallThickness, 
                            'left',
                            jointType.left
                        );
                        const secondSidePanel = this.createSidePanelWithCut(
                            totalLengthToSplit - halfLength, 
                            wallThickness, 
                            'right',
                            jointType.right
                        );
                        
                        // Add optimization notes
                        firstSidePanel.optimizationNote = `Split from last full panel + remaining length to avoid panel < ${minPanelWidth}mm`;
                        firstSidePanel.optimizationSymbol = '✂️';
                        firstSidePanel.optimizationType = 'SPLIT_OPTIMIZATION';
                        firstSidePanel.placementNote = `LEFT SIDE - Split from ${totalLengthToSplit}mm total`;
                        
                        secondSidePanel.optimizationNote = `Split from last full panel + remaining length to avoid panel < ${minPanelWidth}mm`;
                        secondSidePanel.optimizationSymbol = '✂️';
                        secondSidePanel.optimizationType = 'SPLIT_OPTIMIZATION';
                        secondSidePanel.placementNote = `RIGHT SIDE - Split from ${totalLengthToSplit}mm total`;
                        
                        panels.push(firstSidePanel, secondSidePanel);
                    } else {
                        const firstSidePanel = this.createSidePanelWithCut(
                            halfLength, 
                            wallThickness, 
                            'left',
                            jointType
                        );
                        const secondSidePanel = this.createSidePanelWithCut(
                            totalLengthToSplit - halfLength, 
                            wallThickness, 
                            'right',
                            jointType
                        );
                        
                        // Add optimization notes
                        firstSidePanel.optimizationNote = `Split from last full panel + remaining length to avoid panel < ${minPanelWidth}mm`;
                        firstSidePanel.optimizationSymbol = '✂️';
                        firstSidePanel.optimizationType = 'SPLIT_OPTIMIZATION';
                        firstSidePanel.placementNote = `LEFT SIDE - Split from ${totalLengthToSplit}mm total`;
                        
                        secondSidePanel.optimizationNote = `Split from last full panel + remaining length to avoid panel < ${minPanelWidth}mm`;
                        secondSidePanel.optimizationSymbol = '✂️';
                        secondSidePanel.optimizationType = 'SPLIT_OPTIMIZATION';
                        secondSidePanel.placementNote = `RIGHT SIDE - Split from ${totalLengthToSplit}mm total`;
                        
                        panels.push(firstSidePanel, secondSidePanel);
                    }
                    
                    return panels;
                } else {
                    // console.log(`- Wall length (${remainingLength}mm) < minimum panel width (${minPanelWidth}mm)`);
                    // console.log(`- Creating minimum size panel to meet requirements`);
                    
                    // Create a panel with minimum required width
                    const minPanel = this.createSidePanel(minPanelWidth, 'center', jointType);
                    minPanel.optimizationNote = `Minimum size panel created (${minPanelWidth}mm) to meet requirements`;
                    minPanel.optimizationSymbol = '⚠️';
                    minPanel.optimizationType = 'MINIMUM_SIZE_PANEL';
                    minPanel.placementNote = `MINIMUM SIZE - Required ${minPanelWidth}mm, actual wall ${remainingLength}mm`;
                    panels.push(minPanel);
                    
                    return panels;
                }
            }
            //
            if (remainingLength <= threshold) {
                // console.log(`- Remaining length <= threshold (${threshold}mm), creating single side panel`);
                
                // Determine side panel position based on joint types
                let sidePanelPosition;
                if (typeof jointType === 'object') {
                    // Mixed joints - prioritize 45_cut side for side panel
                    sidePanelPosition = jointType.left === '45_cut' ? 'left' : 'right';
                } else {
                    // Uniform joints - default to right side
                    sidePanelPosition = 'right';
                }
                
                // Apply 1130mm optimization to the OPPOSITE END of the side panel
                if (fullPanelsCount > 0) {
                    // console.log(`- Applying 1130mm optimization: side panel goes ${sidePanelPosition}, optimizing opposite end`);
                    const oppositeEndIndex = sidePanelPosition === 'left' ? 
                        panels.length - 1 :  // Rightmost panel if side panel goes left
                        0;                  // Leftmost panel if side panel goes right
                    
                    const oppositePanel = panels[oppositeEndIndex];
                    oppositePanel.actualWidth = this.MAX_PANEL_WIDTH - 20; // 1130mm
                    oppositePanel.optimizationNote = `20mm deducted for ${sidePanelPosition} side panel fit`;
                    oppositePanel.optimizationSymbol = sidePanelPosition === 'left' ? '⬅️' : '➡️';
                    oppositePanel.optimizationType = `${sidePanelPosition.toUpperCase()}_OPTIMIZED`;
                    oppositePanel.placementNote = `${sidePanelPosition.toUpperCase()} END - 20mm deducted for ${sidePanelPosition} side panel fit`;
                    
                    remainingLength += 20; // Add 20mm to side panel
                    // console.log(`- Adjusted remaining length: ${remainingLength}mm (includes 20mm from full panel)`);
                }
                
                // For mixed joint types, try to optimize leftover usage
                if (typeof jointType === 'object' && jointType.left !== jointType.right) {
                    // console.log(`- Mixed joint types detected: left=${jointType.left}, right=${jointType.right}`);
                    
                    // First try to find a compatible leftover for 45° cut
                    const sideNeeding45Cut = jointType.left === '45_cut' ? 'left' : 'right';
                    const compatibleLeftover = this.findCompatibleLeftover(remainingLength, wallThickness, '45_cut');
                    
                    if (compatibleLeftover) {
                        // console.log(`- Found compatible leftover for 45° cut, placing panel on ${sideNeeding45Cut} side`);
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            sideNeeding45Cut,
                            '45_cut'  // Explicitly pass the joint type
                        );
                        panels.push(sidePanel);
                    } else {
                        // If no compatible leftover found, use butt-in side
                        const sideNeedingButtIn = jointType.left === 'butt_in' ? 'left' : 'right';
                        // console.log(`- No compatible leftover found, placing panel on ${sideNeedingButtIn} side (butt-in)`);
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            sideNeedingButtIn,
                            'butt_in'  // Explicitly pass the joint type
                        );
                        panels.push(sidePanel);
                    }
                } else {
                    // For uniform joint types, use the determined position
                    if (typeof jointType === 'object') {
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            sidePanelPosition,
                            jointType[sidePanelPosition]  // Use the joint type for the determined side
                        );
                        panels.push(sidePanel);
                    } else {
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            sidePanelPosition,
                            jointType  // Pass the actual joint type
                        );
                        panels.push(sidePanel);
                    }
                }
            } else {
                // console.log(`- Remaining length > threshold (${threshold}mm), splitting into two side panels`);
                const halfLength = Math.floor(remainingLength / 2);
                // console.log(`- Split lengths: ${halfLength}mm and ${remainingLength - halfLength}mm`);
                
                if (typeof jointType === 'object') {
                    const firstSidePanel = this.createSidePanelWithCut(
                        halfLength, 
                        wallThickness, 
                        'left',
                        jointType.left  // Pass the actual joint type
                    );
                    const secondSidePanel = this.createSidePanelWithCut(
                        remainingLength - halfLength, 
                        wallThickness, 
                        'right',
                        jointType.right  // Pass the actual joint type
                    );
                    panels.push(firstSidePanel, secondSidePanel);
                } else {
                    const firstSidePanel = this.createSidePanelWithCut(
                        halfLength, 
                        wallThickness, 
                        jointType,
                        jointType  // Pass the actual joint type
                    );
                    const secondSidePanel = this.createSidePanelWithCut(
                        remainingLength - halfLength, 
                        wallThickness, 
                        jointType,
                        jointType  // Pass the actual joint type
                    );
                    panels.push(firstSidePanel, secondSidePanel);
                }
            }
        }

        // Add panel placement analysis logs
        // console.log(`\n=== PANEL PLACEMENT ANALYSIS ===`);
        // console.log(`Wall length: ${wallLength}mm | Wall thickness: ${wallThickness}mm | Wall height: ${wallHeight}mm`);
        // console.log(`Threshold: ${threshold}mm | Minimum panel width: ${minPanelWidth}mm`);
        // console.log(`Joint types: ${typeof jointType === 'object' ? `Left: ${jointType.left}, Right: ${jointType.right}` : `Uniform: ${jointType}`}`);
        // console.log(`Total panels created: ${panels.length}`);
        
        // Analyze panel arrangement
        const fullPanels = panels.filter(p => p.isFullPanel);
        const sidePanels = panels.filter(p => p.isSidePanel);
        const leftoverPanels = panels.filter(p => p.isLeftover);
        
        // console.log(`\n--- PANEL BREAKDOWN ---`);
        // console.log(`Full panels: ${fullPanels.length}`);
        fullPanels.forEach((panel, index) => {
            const actualWidth = panel.actualWidth || panel.width;
            const optimization = panel.actualWidth && panel.actualWidth !== panel.width ? 
                ` (${panel.width}mm → ${panel.actualWidth}mm)` : '';
            const symbol = panel.optimizationSymbol || '';
            const placementNote = panel.placementNote || '';
            // console.log(`  Panel ${index + 1}: ${actualWidth}mm${optimization} ${symbol} ${placementNote}`);
        });
        
        // console.log(`Side panels: ${sidePanels.length}`);
        sidePanels.forEach((panel, index) => {
            const position = panel.position || 'N/A';
            // console.log(`  Panel ${index + 1}: ${panel.width}mm at ${position} position`);
        });
        
        // console.log(`Leftover panels: ${leftoverPanels.length}`);
        leftoverPanels.forEach((panel, index) => {
            // console.log(`  Panel ${index + 1}: ${panel.width}mm (from leftover ${panel.leftoverId})`);
        });
        
        // Show panel sequence from left to right
        // console.log(`\n--- PANEL SEQUENCE (LEFT TO RIGHT) ---`);
        panels.forEach((panel, index) => {
            const width = panel.actualWidth || panel.width;
            const type = panel.isFullPanel ? 'FULL' : panel.isSidePanel ? 'SIDE' : 'LEFTOVER';
            const position = panel.position || 'N/A';
            const optimization = panel.actualWidth && panel.actualWidth !== panel.width ? 
                ` (${panel.width}mm → ${panel.actualWidth}mm)` : '';
            const symbol = panel.optimizationSymbol || '';
            const placementNote = panel.placementNote || '';
            
            // Special highlighting for 1130mm panels
            if (panel.optimizationType === 'LEFT_OPTIMIZED') {
                // console.log(`🔴 Panel ${index + 1}: ${width}mm [${type}] ${position}${optimization} ${symbol} ${placementNote}`);
            } else if (panel.isSidePanel) {
                // console.log(`🟢 Panel ${index + 1}: ${width}mm [${type}] ${position}${optimization} ${symbol} ${placementNote}`);
            } else {
                // console.log(`Panel ${index + 1}: ${width}mm [${type}] ${position}${optimization} ${symbol} ${placementNote}`);
            }
        });
        
        // Verify total length
        const totalLength = panels.reduce((sum, panel) => sum + (panel.actualWidth || panel.width), 0);
        // console.log(`\n--- LENGTH VERIFICATION ---`);
        // console.log(`Wall length: ${wallLength}mm`);
        // console.log(`Total panel length: ${totalLength}mm`);
        // console.log(`Difference: ${wallLength - totalLength}mm`);
        
        // Special optimization summary
        const optimizedPanels = panels.filter(p => p.optimizationType && (p.optimizationType.includes('_OPTIMIZED') || p.optimizationType === 'SPLIT_OPTIMIZATION' || p.optimizationType === 'MINIMUM_SIZE_PANEL'));
        if (optimizedPanels.length > 0) {
            // console.log(`\n🔴 --- OPTIMIZATION SUMMARY --- 🔴`);
            optimizedPanels.forEach((panel, index) => {
                // console.log(`🔴 Panel ${panels.indexOf(panel) + 1}: ${panel.width}mm → ${panel.actualWidth || panel.width}mm`);
                // console.log(`   Type: ${panel.optimizationType}`);
                // console.log(`   Note: ${panel.optimizationNote}`);
                // console.log(`   Symbol: ${panel.optimizationSymbol}`);
            });
        }
        
        // console.log(`=== END PANEL PLACEMENT ANALYSIS ===\n`);

        // console.log(`\nCurrent leftovers after calculation:`, this.leftovers);
        // console.log(`Panel analysis:`, this.getPanelAnalysis());
        return panels;
    }

    createSidePanelWithCut(width, wallThickness, position, jointType) {
        // console.log(`\nCreating side panel:`);
        // console.log(`- Width: ${width}mm`);
        // console.log(`- Wall thickness: ${wallThickness}mm`);
        // console.log(`- Position: ${position}`);
        // console.log(`- Joint type: ${jointType}`);
        
        this.panelAnalysis.totalCutPanels++;
        this.panelAnalysis.totalPanels++;

        const compatibleLeftover = this.findCompatibleLeftover(width, wallThickness, jointType);
        // console.log(`\nLooking for compatible leftover:`);
        // console.log(`- Compatible leftover found:`, compatibleLeftover ? 'Yes' : 'No');

        if (compatibleLeftover) {
            // console.log(`\nUsing existing leftover:`);
            // console.log(`- Leftover ID: ${compatibleLeftover.id}`);
            // console.log(`- Current longer face: ${compatibleLeftover.longer_face}mm`);
            // console.log(`- Current shorter face: ${compatibleLeftover.shorter_face}mm`);
            // console.log(`- Left edge type: ${compatibleLeftover.leftEdgeType}`);
            // console.log(`- Right edge type: ${compatibleLeftover.rightEdgeType}`);
            
            const panel = this.createPanelFromLeftover(compatibleLeftover, width, position, jointType);
            this.updateLeftoverAfterCut(compatibleLeftover, width, wallThickness, jointType);
            
            // console.log(`\nAfter cutting leftover:`);
            // console.log(`- New longer face: ${compatibleLeftover.longer_face}mm`);
            // console.log(`- New shorter face: ${compatibleLeftover.shorter_face}mm`);
            // console.log(`- New left edge type: ${compatibleLeftover.leftEdgeType}`);
            // console.log(`- New right edge type: ${compatibleLeftover.rightEdgeType}`);
            
            return panel;
        } else {
            // console.log(`\nNo compatible leftover found, creating new panel and leftover`);
            const panel = this.createSidePanel(width, position, jointType);
            this.panelAnalysis.fullPanelsUsedForCutting++;

            const leftover = {
                id: Date.now() + Math.random(),
                wallThickness,
                leftEdgeType: jointType === '45_cut' ? '45_cut' : 'straight',
                rightEdgeType: 'straight',
                created: Date.now()
            };

            if (jointType === '45_cut') {
                leftover.longer_face = this.MAX_PANEL_WIDTH - width + wallThickness;
                leftover.shorter_face = leftover.longer_face - wallThickness;
            } else {
                leftover.longer_face = this.MAX_PANEL_WIDTH - width;
                leftover.shorter_face = leftover.longer_face;
            }

            // console.log(`\nCreated new leftover:`);
            // console.log(`- ID: ${leftover.id}`);
            // console.log(`- Longer face: ${leftover.longer_face}mm`);
            // console.log(`- Shorter face: ${leftover.shorter_face}mm`);
            // console.log(`- Left edge type: ${leftover.leftEdgeType}`);
            // console.log(`- Right edge type: ${leftover.rightEdgeType}`);

            this.leftovers.push(leftover);
            return panel;
        }
    }
    
    findCompatibleLeftover(neededWidth, wallThickness, jointType) {
        // console.log(`\nSearching for compatible leftover:`);
        // console.log(`- Needed width: ${neededWidth}mm`);
        // console.log(`- Wall thickness: ${wallThickness}mm`);
        // console.log(`- Joint type: ${jointType}`);
        // console.log(`- Current leftovers count: ${this.leftovers.length}`);
        
        return this.leftovers.find(leftover => {
            // console.log(`\nChecking leftover ID ${leftover.id}:`);
            // console.log(`- Wall thickness match: ${leftover.wallThickness === wallThickness}`);
            
            if (leftover.wallThickness !== wallThickness) {
                // console.log(`- Rejected: Wall thickness mismatch`);
                return false;
            }
            
            if (jointType === '45_cut') {
                // console.log(`- Left edge type: ${leftover.leftEdgeType}`);
                // console.log(`- Longer face length: ${leftover.longer_face}mm`);
                
                if (leftover.leftEdgeType === '45_cut') {
                    const hasEnoughLength = leftover.longer_face >= neededWidth;
                    // console.log(`- Has enough length for 45° cut: ${hasEnoughLength}`);
                    return hasEnoughLength;
                }
                const hasEnoughLength = leftover.longer_face >= neededWidth;
                // console.log(`- Has enough length for new 45° cut: ${hasEnoughLength}`);
                return hasEnoughLength;
            } else {
                // console.log(`- Right edge type: ${leftover.rightEdgeType}`);
                // console.log(`- Shorter face length: ${leftover.shorter_face}mm`);
                const isCompatible = leftover.rightEdgeType === 'straight' && leftover.shorter_face >= neededWidth;
                // console.log(`- Is compatible for butt-in: ${isCompatible}`);
                return isCompatible;
            }
        });
    }
    
    updateLeftoverAfterCut(leftover, cutWidth, wallThickness, jointType) {
        // console.log(`\nUpdating leftover after cut:`);
        // console.log(`- Cut width: ${cutWidth}mm`);
        // console.log(`- Wall thickness: ${wallThickness}mm`);
        // console.log(`- Joint type: ${jointType}`);
        // console.log(`- Before update:`);
        // console.log(`  * Longer face: ${leftover.longer_face}mm`);
        // console.log(`  * Shorter face: ${leftover.shorter_face}mm`);
        // console.log(`  * Left edge type: ${leftover.leftEdgeType}`);
        // console.log(`  * Right edge type: ${leftover.rightEdgeType}`);

        if (jointType === '45_cut') {
            if (leftover.leftEdgeType === '45_cut') {
                // console.log(`\nReusing existing 45° cut:`);
                leftover.longer_face -= cutWidth;
                leftover.shorter_face = leftover.longer_face;
                leftover.leftEdgeType = 'straight';
            } else {
                // console.log(`\nCreating new 45° cut:`);
                leftover.longer_face = leftover.longer_face - cutWidth + wallThickness;
                leftover.shorter_face = leftover.longer_face - wallThickness;
                leftover.leftEdgeType = '45_cut';
            }
        } else {
            // console.log(`\nButt-in joint:`);
            leftover.longer_face -= cutWidth;
            leftover.shorter_face = leftover.longer_face;
            leftover.rightEdgeType = 'straight';
        }

        // console.log(`\nAfter update:`);
        // console.log(`- Longer face: ${leftover.longer_face}mm`);
        // console.log(`- Shorter face: ${leftover.shorter_face}mm`);
        // console.log(`- Left edge type: ${leftover.leftEdgeType}`);
        // console.log(`- Right edge type: ${leftover.rightEdgeType}`);

        // Clean up leftovers after updating
        this.cleanupLeftovers();
    }

    // Helper methods for creating different types of panels
    createFullPanel(jointType) {
        this.panelAnalysis.totalFullPanels++;
        this.panelAnalysis.totalPanels++;
        return {
            width: this.MAX_PANEL_WIDTH,
            actualWidth: this.MAX_PANEL_WIDTH, // Default actual width (will be adjusted if needed)
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

    createPanelFromLeftover(leftover, width, position, jointType) {
        this.panelAnalysis.totalLeftoverPanels++;
        this.panelAnalysis.totalPanels++;
        return {
            width: width,
            isLeftover: true,
            leftoverId: leftover.id,
            position: position,
            jointType: jointType,
            type: 'side'
        };
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

    // Test method for specific dataset
    calculateTestDataset() {
        const calculator = new PanelCalculator();
        
        // Wall 4542 (4800mm, height 3000mm - below threshold)
        console.log("Wall 4542 (4800mm, height 3000mm):");
        // Wall 4542 has butt_in joints on both sides
        const wall4542Panels = calculator.calculatePanels(4800, 100, {left: 'butt_in', right: 'butt_in'}, 3000);
        console.log("Panels:", wall4542Panels);
        console.log("Leftovers after Wall 4542:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4544 (10000mm, height 6000mm - above threshold)
        console.log("\nWall 4544 (10000mm, height 6000mm):");
        // Wall 4544 has 45_cut joints on both sides
        const wall4544Panels = calculator.calculatePanels(10000, 100, {left: '45_cut', right: '45_cut'}, 6000);
        console.log("Panels:", wall4544Panels);
        console.log("Leftovers after Wall 4544:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4543 (10000mm, height 6000mm - above threshold)
        console.log("\nWall 4543 (10000mm, height 6000mm):");
        // Wall 4543 has 45_cut joints on both sides
        const wall4543Panels = calculator.calculatePanels(10000, 100, {left: '45_cut', right: '45_cut'}, 6000);
        console.log("Panels:", wall4543Panels);
        console.log("Leftovers after Wall 4543:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4534 (5000mm, height 3000mm - below threshold)
        console.log("\nWall 4534 (5000mm, height 3000mm):");
        // Wall 4534 has 45_cut joints on both sides
        const wall4534Panels = calculator.calculatePanels(5000, 100, {left: '45_cut', right: '45_cut'}, 3000);
        console.log("Panels:", wall4534Panels);
        console.log("Leftovers after Wall 4534:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4536 (5000mm, height 5500mm - above threshold)
        console.log("\nWall 4536 (5000mm, height 5500mm):");
        // Wall 4536 has 45_cut joints on both sides
        const wall4536Panels = calculator.calculatePanels(5000, 100, {left: '45_cut', right: '45_cut'}, 5500);
        console.log("Panels:", wall4536Panels);
        console.log("Leftovers after Wall 4536:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        return {
            wall4542: wall4542Panels,
            wall4544: wall4544Panels,
            wall4543: wall4543Panels,
            wall4534: wall4534Panels,
            wall4536: wall4536Panels,
            analysis: calculator.getPanelAnalysis(),
            leftovers: calculator.leftovers
        };
    }
}

export default PanelCalculator; 