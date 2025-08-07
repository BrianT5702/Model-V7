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

    // Enhanced panel calculation with 45-degree cut handling
    calculatePanels(wallLength, wallThickness, jointType) {
        console.log(`\n=== Starting calculation for wall length: ${wallLength}mm, thickness: ${wallThickness}mm ===`);
        console.log(`Joint type:`, jointType);
        
        const panels = [];
        let remainingLength = wallLength;

        // Calculate full panels needed
        const fullPanelsCount = Math.floor(remainingLength / this.MAX_PANEL_WIDTH);
        console.log(`\nFull panels calculation:`);
        console.log(`- Full panels needed: ${fullPanelsCount}`);
        
        for (let i = 0; i < fullPanelsCount; i++) {
            panels.push(this.createFullPanel(jointType));
            remainingLength -= this.MAX_PANEL_WIDTH;
        }
        console.log(`- Remaining length after full panels: ${remainingLength}mm`);

        // Handle remaining length
        if (remainingLength > 0) {
            console.log(`\nHandling remaining length: ${remainingLength}mm`);
            if (remainingLength <= (wallThickness * 2)) {
                console.log(`- Remaining length <= 2 * wall thickness, creating single side panel`);
                
                // For mixed joint types, try to optimize leftover usage
                if (typeof jointType === 'object' && jointType.left !== jointType.right) {
                    console.log(`- Mixed joint types detected: left=${jointType.left}, right=${jointType.right}`);
                    
                    // First try to find a compatible leftover for 45° cut
                    const sideNeeding45Cut = jointType.left === '45_cut' ? 'left' : 'right';
                    const compatibleLeftover = this.findCompatibleLeftover(remainingLength, wallThickness, '45_cut');
                    
                    if (compatibleLeftover) {
                        console.log(`- Found compatible leftover for 45° cut, placing panel on ${sideNeeding45Cut} side`);
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
                        console.log(`- No compatible leftover found, placing panel on ${sideNeedingButtIn} side (butt-in)`);
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            sideNeedingButtIn,
                            'butt_in'  // Explicitly pass the joint type
                        );
                        panels.push(sidePanel);
                    }
                } else {
                    // For uniform joint types, use the original logic
                    if (typeof jointType === 'object') {
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            jointType.left === '45_cut' ? 'left' : 'right',
                            jointType.left  // Pass the actual joint type
                        );
                        panels.push(sidePanel);
                    } else {
                        const sidePanel = this.createSidePanelWithCut(
                            remainingLength, 
                            wallThickness, 
                            jointType,
                            jointType  // Pass the actual joint type
                        );
                        panels.push(sidePanel);
                    }
                }
            } else {
                console.log(`- Remaining length > 2 * wall thickness, splitting into two side panels`);
                const halfLength = Math.floor(remainingLength / 2);
                console.log(`- Split lengths: ${halfLength}mm and ${remainingLength - halfLength}mm`);
                
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

        console.log(`\nCurrent leftovers after calculation:`, this.leftovers);
        console.log(`Panel analysis:`, this.getPanelAnalysis());
        return panels;
    }

    createSidePanelWithCut(width, wallThickness, position, jointType) {
        console.log(`\nCreating side panel:`);
        console.log(`- Width: ${width}mm`);
        console.log(`- Wall thickness: ${wallThickness}mm`);
        console.log(`- Position: ${position}`);
        console.log(`- Joint type: ${jointType}`);
        
        this.panelAnalysis.totalCutPanels++;
        this.panelAnalysis.totalPanels++;

        const compatibleLeftover = this.findCompatibleLeftover(width, wallThickness, jointType);
        console.log(`\nLooking for compatible leftover:`);
        console.log(`- Compatible leftover found:`, compatibleLeftover ? 'Yes' : 'No');

        if (compatibleLeftover) {
            console.log(`\nUsing existing leftover:`);
            console.log(`- Leftover ID: ${compatibleLeftover.id}`);
            console.log(`- Current longer face: ${compatibleLeftover.longer_face}mm`);
            console.log(`- Current shorter face: ${compatibleLeftover.shorter_face}mm`);
            console.log(`- Left edge type: ${compatibleLeftover.leftEdgeType}`);
            console.log(`- Right edge type: ${compatibleLeftover.rightEdgeType}`);
            
            const panel = this.createPanelFromLeftover(compatibleLeftover, width, position, jointType);
            this.updateLeftoverAfterCut(compatibleLeftover, width, wallThickness, jointType);
            
            console.log(`\nAfter cutting leftover:`);
            console.log(`- New longer face: ${compatibleLeftover.longer_face}mm`);
            console.log(`- New shorter face: ${compatibleLeftover.shorter_face}mm`);
            console.log(`- New left edge type: ${compatibleLeftover.leftEdgeType}`);
            console.log(`- New right edge type: ${compatibleLeftover.rightEdgeType}`);
            
            return panel;
        } else {
            console.log(`\nNo compatible leftover found, creating new panel and leftover`);
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

            console.log(`\nCreated new leftover:`);
            console.log(`- ID: ${leftover.id}`);
            console.log(`- Longer face: ${leftover.longer_face}mm`);
            console.log(`- Shorter face: ${leftover.shorter_face}mm`);
            console.log(`- Left edge type: ${leftover.leftEdgeType}`);
            console.log(`- Right edge type: ${leftover.rightEdgeType}`);

            this.leftovers.push(leftover);
            return panel;
        }
    }
    
    findCompatibleLeftover(neededWidth, wallThickness, jointType) {
        console.log(`\nSearching for compatible leftover:`);
        console.log(`- Needed width: ${neededWidth}mm`);
        console.log(`- Wall thickness: ${wallThickness}mm`);
        console.log(`- Joint type: ${jointType}`);
        console.log(`- Current leftovers count: ${this.leftovers.length}`);
        
        return this.leftovers.find(leftover => {
            console.log(`\nChecking leftover ID ${leftover.id}:`);
            console.log(`- Wall thickness match: ${leftover.wallThickness === wallThickness}`);
            
            if (leftover.wallThickness !== wallThickness) {
                console.log(`- Rejected: Wall thickness mismatch`);
                return false;
            }
            
            if (jointType === '45_cut') {
                console.log(`- Left edge type: ${leftover.leftEdgeType}`);
                console.log(`- Longer face length: ${leftover.longer_face}mm`);
                
                if (leftover.leftEdgeType === '45_cut') {
                    const hasEnoughLength = leftover.longer_face >= neededWidth;
                    console.log(`- Has enough length for 45° cut: ${hasEnoughLength}`);
                    return hasEnoughLength;
                }
                const hasEnoughLength = leftover.longer_face >= neededWidth;
                console.log(`- Has enough length for new 45° cut: ${hasEnoughLength}`);
                return hasEnoughLength;
            } else {
                console.log(`- Right edge type: ${leftover.rightEdgeType}`);
                console.log(`- Shorter face length: ${leftover.shorter_face}mm`);
                const isCompatible = leftover.rightEdgeType === 'straight' && leftover.shorter_face >= neededWidth;
                console.log(`- Is compatible for butt-in: ${isCompatible}`);
                return isCompatible;
            }
        });
    }
    
    updateLeftoverAfterCut(leftover, cutWidth, wallThickness, jointType) {
        console.log(`\nUpdating leftover after cut:`);
        console.log(`- Cut width: ${cutWidth}mm`);
        console.log(`- Wall thickness: ${wallThickness}mm`);
        console.log(`- Joint type: ${jointType}`);
        console.log(`- Before update:`);
        console.log(`  * Longer face: ${leftover.longer_face}mm`);
        console.log(`  * Shorter face: ${leftover.shorter_face}mm`);
        console.log(`  * Left edge type: ${leftover.leftEdgeType}`);
        console.log(`  * Right edge type: ${leftover.rightEdgeType}`);

        if (jointType === '45_cut') {
            if (leftover.leftEdgeType === '45_cut') {
                console.log(`\nReusing existing 45° cut:`);
                leftover.longer_face -= cutWidth;
                leftover.shorter_face = leftover.longer_face;
                leftover.leftEdgeType = 'straight';
            } else {
                console.log(`\nCreating new 45° cut:`);
                leftover.longer_face = leftover.longer_face - cutWidth + wallThickness;
                leftover.shorter_face = leftover.longer_face - wallThickness;
                leftover.leftEdgeType = '45_cut';
            }
        } else {
            console.log(`\nButt-in joint:`);
            leftover.longer_face -= cutWidth;
            leftover.shorter_face = leftover.longer_face;
            leftover.rightEdgeType = 'straight';
        }

        console.log(`\nAfter update:`);
        console.log(`- Longer face: ${leftover.longer_face}mm`);
        console.log(`- Shorter face: ${leftover.shorter_face}mm`);
        console.log(`- Left edge type: ${leftover.leftEdgeType}`);
        console.log(`- Right edge type: ${leftover.rightEdgeType}`);

        // Clean up leftovers after updating
        this.cleanupLeftovers();
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
        
        // Wall 4542 (4800mm)
        console.log("Wall 4542 (4800mm):");
        // Wall 4542 has butt_in joints on both sides
        const wall4542Panels = calculator.calculatePanels(4800, 100, {left: 'butt_in', right: 'butt_in'});
        console.log("Panels:", wall4542Panels);
        console.log("Leftovers after Wall 4542:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4544 (10000mm)
        console.log("\nWall 4544 (10000mm):");
        // Wall 4544 has 45_cut joints on both sides
        const wall4544Panels = calculator.calculatePanels(10000, 100, {left: '45_cut', right: '45_cut'});
        console.log("Panels:", wall4544Panels);
        console.log("Leftovers after Wall 4544:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4543 (10000mm)
        console.log("\nWall 4543 (10000mm):");
        // Wall 4543 has 45_cut joints on both sides
        const wall4543Panels = calculator.calculatePanels(10000, 100, {left: '45_cut', right: '45_cut'});
        console.log("Panels:", wall4543Panels);
        console.log("Leftovers after Wall 4543:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4534 (5000mm)
        console.log("\nWall 4534 (5000mm):");
        // Wall 4534 has 45_cut joints on both sides
        const wall4534Panels = calculator.calculatePanels(5000, 100, {left: '45_cut', right: '45_cut'});
        console.log("Panels:", wall4534Panels);
        console.log("Leftovers after Wall 4534:", calculator.leftovers);
        console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4536 (5000mm)
        console.log("\nWall 4536 (5000mm):");
        // Wall 4536 has 45_cut joints on both sides
        const wall4536Panels = calculator.calculatePanels(5000, 100, {left: '45_cut', right: '45_cut'});
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