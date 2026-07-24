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

    // Drop leftovers too small to keep (LF or SF below wall thickness).
    cleanupLeftovers() {
        this.leftovers = this.leftovers.filter((leftover) => {
            const wallThickness = Number(leftover.wallThickness) || 0;
            return (
                leftover.longer_face > 0 &&
                leftover.shorter_face > 0 &&
                leftover.longer_face >= wallThickness &&
                leftover.shorter_face >= wallThickness
            );
        });
    }

    splitLengthPair(totalLength) {
        const total = Math.round(totalLength);
        const first = Math.floor(total / 2);
        return [first, total - first];
    }

    /**
     * True when wall faces are identical both sides — panel can be flipped freely.
     * Also true when leftover faces would match wall after a flip.
     */
    facesMatchWithOptionalFlip(leftover, faceInfo) {
        const exact =
            leftover.innerFaceMaterial === faceInfo.innerFaceMaterial &&
            leftover.innerFaceThickness === faceInfo.innerFaceThickness &&
            leftover.outerFaceMaterial === faceInfo.outerFaceMaterial &&
            leftover.outerFaceThickness === faceInfo.outerFaceThickness;
        if (exact) return { match: true, flipped: false };

        const flipped =
            leftover.innerFaceMaterial === faceInfo.outerFaceMaterial &&
            leftover.innerFaceThickness === faceInfo.outerFaceThickness &&
            leftover.outerFaceMaterial === faceInfo.innerFaceMaterial &&
            leftover.outerFaceThickness === faceInfo.innerFaceThickness;
        if (flipped) return { match: true, flipped: true };

        return { match: false, flipped: false };
    }

    /** Wall has same finish both sides → side panel may be placed left or right for leftover reuse. */
    wallAllowsSideFlip(faceInfo = null) {
        const info = faceInfo || this.currentFaceInfo || {};
        return (
            info.innerFaceMaterial != null &&
            info.innerFaceMaterial === info.outerFaceMaterial &&
            info.innerFaceThickness === info.outerFaceThickness
        );
    }

    /**
     * For a single side-panel remainder: pick left (needs 母) or right (needs 公)
     * preferring a side that can reuse leftover when flip is allowed.
     */
    chooseSidePanelPosition(remainingLength, wallThickness, jointType, defaultPosition) {
        const leftJoint = typeof jointType === 'object' ? jointType.left : jointType;
        const rightJoint = typeof jointType === 'object' ? jointType.right : jointType;

        // Only freely choose side when both ends need the same corner cut style,
        // and faces allow flip (same material both sides).
        const sameCornerStyle = leftJoint === rightJoint;
        if (!sameCornerStyle || !this.wallAllowsSideFlip()) {
            return defaultPosition;
        }

        const leftMatch = this.findCompatibleLeftover(
            remainingLength, wallThickness, leftJoint, this.currentFaceInfo,
            0, this.leftovers.length, 'left',
            leftJoint === '45_cut' ? (this.currentCutSlashes?.left || '/') : null
        );
        const rightMatch = this.findCompatibleLeftover(
            remainingLength, wallThickness, rightJoint, this.currentFaceInfo,
            0, this.leftovers.length, 'right',
            rightJoint === '45_cut' ? (this.currentCutSlashes?.right || '/') : null
        );

        if (rightMatch && !leftMatch) return 'right';
        if (leftMatch && !rightMatch) return 'left';
        if (leftMatch && rightMatch) return defaultPosition;
        return defaultPosition;
    }

    // Enhanced panel calculation with 45-degree cut handling and 20mm optimization
    calculatePanels(wallLength, wallThickness, jointType, wallHeight = 3000, faceInfo = null, cutSlashes = null) {
        // Store wallHeight for leftover tracking
        this.currentWallHeight = wallHeight;
        
        // Store face information for leftover tracking
        this.currentFaceInfo = faceInfo || {
            innerFaceMaterial: null,
            innerFaceThickness: null,
            outerFaceMaterial: null,
            outerFaceThickness: null
        };

        // Required 45° slash per end from joining-wall side ('/' or '\\')
        this.currentCutSlashes = cutSlashes || { left: null, right: null };
        
        const panels = [];
        wallLength = Math.round(wallLength);
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
                    
                    // Decrement the totalFullPanels counter since we're splitting it
                    this.panelAnalysis.totalFullPanels--;
                    
                    // Calculate the total length to be split
                    // Use the actual width of the last panel (could be 1150mm or 1130mm if optimized)
                    const lastPanelActualWidth = lastFullPanel.actualWidth || lastFullPanel.width;
                    const totalLengthToSplit = lastPanelActualWidth + remainingLength;
                    const [halfLength, secondHalfLength] = this.splitLengthPair(totalLengthToSplit);
                    
                    // console.log(`- Last panel actual width: ${lastPanelActualWidth}mm`);
                    // console.log(`- Total length to split: ${totalLengthToSplit}mm`);
                    // console.log(`- Split lengths: ${halfLength}mm and ${totalLengthToSplit - halfLength}mm`);
                    
                    // Create two side panels: left needs 母, right needs 公.
                    // Prefer cutting both from one full panel (first cut leaves 公 leftover,
                    // second cut reuses it). Middle remainder becomes scrap (no factory joint).
                    if (typeof jointType === 'object') {
                        const firstSidePanel = this.createSidePanelWithCut(
                            halfLength, 
                            wallThickness, 
                            'left',
                            jointType.left
                        );
                        const secondSidePanel = this.createSidePanelWithCut(
                            secondHalfLength, 
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
                            secondHalfLength, 
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
                // Default side: prefer 45_cut end when joints differ; else left if left is 45_cut, else right
                let sidePanelPosition;
                if (typeof jointType === 'object') {
                    sidePanelPosition = jointType.left === '45_cut' ? 'left' : 'right';
                } else {
                    sidePanelPosition = 'right';
                }

                // When both faces are the same material, we may flip the panel and place
                // the single side panel on left (needs 母) OR right (needs 公) to reuse leftover.
                const tentativeSideWidth = fullPanelsCount > 0 ? remainingLength + 20 : remainingLength;
                sidePanelPosition = this.chooseSidePanelPosition(
                    tentativeSideWidth,
                    wallThickness,
                    jointType,
                    sidePanelPosition
                );

                // Mixed joints: prefer the 45° end when a leftover fits; otherwise the butt end.
                // Resolve the FINAL side before shortening the opposite full to 1130.
                let sideJointType = typeof jointType === 'object'
                    ? jointType[sidePanelPosition]
                    : jointType;
                if (typeof jointType === 'object' && jointType.left !== jointType.right) {
                    const sideNeeding45Cut = jointType.left === '45_cut' ? 'left' : 'right';
                    const sideNeedingButtIn = jointType.left === 'butt_in' ? 'left' : 'right';
                    const compatibleLeftover = this.findCompatibleLeftover(
                        tentativeSideWidth,
                        wallThickness,
                        '45_cut',
                        this.currentFaceInfo,
                        0,
                        this.leftovers.length,
                        sideNeeding45Cut,
                        this.currentCutSlashes?.[sideNeeding45Cut] || '/'
                    );
                    if (compatibleLeftover) {
                        sidePanelPosition = sideNeeding45Cut;
                        sideJointType = '45_cut';
                    } else {
                        sidePanelPosition = sideNeedingButtIn;
                        sideJointType = 'butt_in';
                    }
                }

                // Shorten the OPPOSITE end from where the SP will actually sit.
                if (fullPanelsCount > 0) {
                    const oppositeEndIndex = sidePanelPosition === 'left'
                        ? panels.length - 1
                        : 0;

                    const oppositePanel = panels[oppositeEndIndex];
                    oppositePanel.actualWidth = this.MAX_PANEL_WIDTH - 20; // 1130mm
                    oppositePanel.optimizationNote = `20mm deducted for ${sidePanelPosition} side panel fit`;
                    oppositePanel.optimizationSymbol = sidePanelPosition === 'left' ? '⬅️' : '➡️';
                    oppositePanel.optimizationType = `${sidePanelPosition.toUpperCase()}_OPTIMIZED`;
                    oppositePanel.placementNote = `${sidePanelPosition.toUpperCase()} END - 20mm deducted for ${sidePanelPosition} side panel fit`;

                    remainingLength += 20;
                }

                const sidePanel = this.createSidePanelWithCut(
                    remainingLength,
                    wallThickness,
                    sidePanelPosition,
                    sideJointType
                );
                panels.push(sidePanel);
            } else {
                // rem > threshold: left SP needs 母, right SP needs 公.
                // Cut left first; right should reuse the leftover's remaining 公 when possible.
                const [halfLength, secondHalfLength] = this.splitLengthPair(remainingLength);
                
                if (typeof jointType === 'object') {
                    const firstSidePanel = this.createSidePanelWithCut(
                        halfLength, 
                        wallThickness, 
                        'left',
                        jointType.left
                    );
                    const secondSidePanel = this.createSidePanelWithCut(
                        secondHalfLength, 
                        wallThickness, 
                        'right',
                        jointType.right
                    );
                    panels.push(firstSidePanel, secondSidePanel);
                } else {
                    const firstSidePanel = this.createSidePanelWithCut(
                        halfLength, 
                        wallThickness, 
                        'left',
                        jointType
                    );
                    const secondSidePanel = this.createSidePanelWithCut(
                        secondHalfLength, 
                        wallThickness, 
                        'right',
                        jointType
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

    createSidePanelWithCut(width, wallThickness, position, jointType, leftoverSearchEndIndex = undefined) {
        width = Math.round(width);
        
        this.panelAnalysis.totalCutPanels++;
        this.panelAnalysis.totalPanels++;

        const searchEndIndex =
            typeof leftoverSearchEndIndex === 'number'
                ? leftoverSearchEndIndex
                : this.leftovers.length;
        // Factory panel: [公 left] ━━━ [母 right].
        // Left side panel mates with leftmost full panel's 公 → needs 母 → cut from RIGHT.
        // Right side panel mates with rightmost full panel's 母 → needs 公 → cut from LEFT.
        const needsMotherJoint = position === 'left'; // 母
        const needsMaleJoint = position === 'right'; // 公
        const neededSlash = jointType === '45_cut'
            ? (this.currentCutSlashes?.[position] || '/')
            : null;

        const compatibleLeftover = this.findCompatibleLeftover(
            width,
            wallThickness,
            jointType,
            this.currentFaceInfo,
            0,
            searchEndIndex,
            position,
            neededSlash
        );

        if (compatibleLeftover) {
            const panel = this.createPanelFromLeftover(compatibleLeftover, width, position, jointType);
            panel.cutSlash = neededSlash;
            this.updateLeftoverAfterCut(compatibleLeftover, width, wallThickness, jointType, position, neededSlash);
            return panel;
        } else {
            const panel = this.createSidePanel(width, position, jointType);
            panel.cutSlash = neededSlash;
            this.panelAnalysis.fullPanelsUsedForCutting++;

            const leftover = {
                id: Date.now() + Math.random(),
                wallThickness,
                // Stock: [公 left] ━━━ [母 right]. Cut side gets the shop edge; other end keeps factory.
                leftEdgeType: needsMaleJoint
                    ? (jointType === '45_cut' ? '45_cut' : 'straight')
                    : 'straight',
                rightEdgeType: needsMotherJoint
                    ? (jointType === '45_cut' ? '45_cut' : 'straight')
                    : 'straight',
                leftEdgeSlash: needsMaleJoint ? neededSlash : null,
                rightEdgeSlash: needsMotherJoint ? neededSlash : null,
                created: Date.now(),
                panelLength: this.currentWallHeight || 3000,
                leftJointConsumed: needsMaleJoint,
                rightJointConsumed: needsMotherJoint,
                innerFaceMaterial: this.currentFaceInfo.innerFaceMaterial,
                innerFaceThickness: this.currentFaceInfo.innerFaceThickness,
                outerFaceMaterial: this.currentFaceInfo.outerFaceMaterial,
                outerFaceThickness: this.currentFaceInfo.outerFaceThickness
            };

            if (jointType === '45_cut') {
                leftover.longer_face = this.MAX_PANEL_WIDTH - width + wallThickness;
                leftover.shorter_face = leftover.longer_face - wallThickness;
            } else {
                leftover.longer_face = this.MAX_PANEL_WIDTH - width;
                leftover.shorter_face = leftover.longer_face;
            }

            this.leftovers.push(leftover);
            return panel;
        }
    }
    
    findCompatibleLeftover(neededWidth, wallThickness, jointType, faceInfo = null, searchStartIndex = 0, searchEndIndex = this.leftovers.length, position = null, neededSlash = null) {
        const currentFaceInfo = faceInfo || this.currentFaceInfo || {
            innerFaceMaterial: null,
            innerFaceThickness: null,
            outerFaceMaterial: null,
            outerFaceThickness: null
        };

        const upperBound = Math.min(
            typeof searchEndIndex === 'number' ? searchEndIndex : this.leftovers.length,
            this.leftovers.length
        );

        // Left side needs 母 (right factory end); right side needs 公 (left factory end).
        const needsMotherJoint = position === 'left';
        const needsMaleJoint = position === 'right';
        // Cutting from right of leftover (left SP) → new shop cut is on leftover's right edge after.
        // Cutting from left of leftover (right SP) → new shop cut on leftover's left edge.
        const cutOnRight = position === 'left';

        for (let i = searchStartIndex; i < upperBound; i++) {
            const leftover = this.leftovers[i];

            if (leftover.wallThickness !== wallThickness) {
                continue;
            }

            if (leftover.panelLength < this.currentWallHeight) {
                continue;
            }

            const leftoverHasFaceInfo = leftover.innerFaceMaterial !== undefined || leftover.outerFaceMaterial !== undefined;
            const currentHasFaceInfo = currentFaceInfo.innerFaceMaterial !== null || currentFaceInfo.outerFaceMaterial !== null;

            let faceFlipped = false;
            if (leftoverHasFaceInfo || currentHasFaceInfo) {
                const faceMatch = this.facesMatchWithOptionalFlip(leftover, currentFaceInfo);
                if (!faceMatch.match) {
                    continue;
                }
                faceFlipped = faceMatch.flipped;
            }

            // Factory joint availability by wall position
            if (needsMotherJoint && leftover.rightJointConsumed) continue;
            if (needsMaleJoint && leftover.leftJointConsumed) continue;

            // 45° slash on an existing shop-cut edge must match (or match after allowed face flip).
            // Cutting into a factory/straight end always uses the needed slash — no check.
            if (jointType === '45_cut' && neededSlash) {
                const existingSlash = cutOnRight ? leftover.rightEdgeSlash : leftover.leftEdgeSlash;
                if (existingSlash === '/' || existingSlash === '\\') {
                    const flipSlash = (s) => (s === '/' ? '\\' : '/');
                    const effectiveSlash = faceFlipped ? flipSlash(existingSlash) : existingSlash;
                    const matches = effectiveSlash === neededSlash;
                    const matchesViaExtraFlip =
                        !faceFlipped &&
                        this.wallAllowsSideFlip(currentFaceInfo) &&
                        flipSlash(existingSlash) === neededSlash;
                    if (!matches && !matchesViaExtraFlip) continue;
                }
            }

            // Size check for 45°:
            // - shorter_face always OK
            // - longer_face only if faces still match after flip (same both sides / flip-compatible)
            if (jointType === '45_cut') {
                if (leftover.shorter_face >= neededWidth) return leftover;
                const canUseLongerFace =
                    leftover.longer_face >= neededWidth &&
                    (faceFlipped || this.wallAllowsSideFlip(currentFaceInfo));
                if (canUseLongerFace) return leftover;
            } else if (leftover.shorter_face >= neededWidth) {
                return leftover;
            }
        }

        return null;
    }
    
    updateLeftoverAfterCut(leftover, cutWidth, wallThickness, jointType, position = null, neededSlash = null) {
        // Mark which factory joint was taken for this side panel
        if (position === 'left') {
            leftover.rightJointConsumed = true; // took 母 — shop cut on RIGHT of leftover
        } else if (position === 'right') {
            leftover.leftJointConsumed = true; // took 公 — shop cut on LEFT of leftover
        }

        const cutOnRight = position === 'left';
        const cutEdgeKey = cutOnRight ? 'rightEdgeType' : 'leftEdgeType';
        const cutSlashKey = cutOnRight ? 'rightEdgeSlash' : 'leftEdgeSlash';
        const otherEdgeKey = cutOnRight ? 'leftEdgeType' : 'rightEdgeType';
        const otherIs45 = leftover[otherEdgeKey] === '45_cut';
        const slash = jointType === '45_cut' ? (neededSlash || '/') : null;

        if (jointType === '45_cut') {
            if (otherIs45) {
                const otherSlashKey = cutOnRight ? 'leftEdgeSlash' : 'rightEdgeSlash';
                const otherSlash = leftover[otherSlashKey];
                // Same slash both ends → parallel cuts → parallelogram (LF = SF).
                // Opposite slashes → mirrored → trapezoid (LF − SF = 2 × thickness).
                if (otherSlash && slash && otherSlash === slash) {
                    // Each face loses `width` on one end and `width − T` on the other:
                    // remaining = LF − width = SF − (width − T)  (e.g. 1150−350−200=600).
                    const face = leftover.longer_face - cutWidth;
                    leftover.longer_face = face;
                    leftover.shorter_face = face;
                } else {
                    leftover.longer_face = leftover.longer_face - cutWidth + wallThickness;
                    leftover.shorter_face = leftover.shorter_face - cutWidth;
                }
            } else {
                // First 45° shop cut on this leftover
                leftover.longer_face = leftover.longer_face - cutWidth + wallThickness;
                leftover.shorter_face = leftover.longer_face - wallThickness;
            }
            leftover[cutEdgeKey] = '45_cut';
            leftover[cutSlashKey] = slash;
        } else {
            leftover.longer_face -= cutWidth;
            if (otherIs45) {
                leftover.shorter_face = leftover.longer_face - wallThickness;
            } else {
                leftover.shorter_face = leftover.longer_face;
            }
            leftover[cutEdgeKey] = 'straight';
            leftover[cutSlashKey] = null;
        }

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
        width = Math.round(width);
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
        width = Math.round(width);
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

    /**
     * Lower score = less waste. Used when comparing wall processing orders.
     */
    getOptimizationScore() {
        const leftoverArea = this.leftovers.reduce((sum, leftover) => {
            const faceWidth = Math.max(leftover.longer_face || 0, leftover.shorter_face || 0);
            const panelLength = leftover.panelLength || this.currentWallHeight || 0;
            return sum + (faceWidth * panelLength);
        }, 0);

        const usableLeftoverCount = this.leftovers.filter((leftover) =>
            (leftover.longer_face || 0) >= 50 && (leftover.shorter_face || 0) >= 50
        ).length;

        return {
            fullPanelsUsedForCutting: this.panelAnalysis.fullPanelsUsedForCutting,
            leftoverReused: this.panelAnalysis.totalLeftoverPanels,
            leftoverArea,
            usableLeftoverCount,
            totalPanels: this.panelAnalysis.totalPanels,
        };
    }

    // Test method for specific dataset
    calculateTestDataset() {
        const calculator = new PanelCalculator();
        
        // Wall 4542 (4800mm, height 3000mm - below threshold)
        // console.log("Wall 4542 (4800mm, height 3000mm):");
        // Wall 4542 has butt_in joints on both sides
        const wall4542Panels = calculator.calculatePanels(4800, 100, {left: 'butt_in', right: 'butt_in'}, 3000);
        // console.log("Panels:", wall4542Panels);
        // console.log("Leftovers after Wall 4542:", calculator.leftovers);
        // console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4544 (10000mm, height 6000mm - above threshold)
        // console.log("\nWall 4544 (10000mm, height 6000mm):");
        // Wall 4544 has 45_cut joints on both sides
        const wall4544Panels = calculator.calculatePanels(10000, 100, {left: '45_cut', right: '45_cut'}, 6000);
        // console.log("Panels:", wall4544Panels);
        // console.log("Leftovers after Wall 4544:", calculator.leftovers);
        // console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4543 (10000mm, height 6000mm - above threshold)
        // console.log("\nWall 4543 (10000mm, height 6000mm):");
        // Wall 4543 has 45_cut joints on both sides
        const wall4543Panels = calculator.calculatePanels(10000, 100, {left: '45_cut', right: '45_cut'}, 6000);
        // console.log("Panels:", wall4543Panels);
        // console.log("Leftovers after Wall 4543:", calculator.leftovers);
        // console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4534 (5000mm, height 3000mm - below threshold)
        // console.log("\nWall 4534 (5000mm, height 3000mm):");
        // Wall 4534 has 45_cut joints on both sides
        const wall4534Panels = calculator.calculatePanels(5000, 100, {left: '45_cut', right: '45_cut'}, 3000);
        // console.log("Panels:", wall4534Panels);
        // console.log("Leftovers after Wall 4534:", calculator.leftovers);
        // console.log("Analysis:", calculator.getPanelAnalysis());
        
        // Wall 4536 (5000mm, height 5500mm - above threshold)
        // console.log("\nWall 4536 (5000mm, height 5500mm):");
        // Wall 4536 has 45_cut joints on both sides
        const wall4536Panels = calculator.calculatePanels(5000, 100, {left: '45_cut', right: '45_cut'}, 5500);
        // console.log("Panels:", wall4536Panels);
        // console.log("Leftovers after Wall 4536:", calculator.leftovers);
        // console.log("Analysis:", calculator.getPanelAnalysis());
        
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